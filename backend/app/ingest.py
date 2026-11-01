"""Download January 2026 wind actuals and day-ahead forecast vintages from Elexon BMRS."""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from .config import (
    API_BASE,
    DATA_DIR,
    DECISION_CUTOFF_LOCAL,
    END_DATE_EXCLUSIVE,
    FORECAST_LOOKBACK_DAYS,
    START_DATE,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("windcast.ingest")
LONDON = ZoneInfo("Europe/London")


def _unwrap(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get("data", payload.get("results", []))
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected Elexon response shape: {type(payload).__name__}")
    return [row for row in payload if isinstance(row, dict)]


def _get_json(path: str, params: dict[str, str], attempts: int = 4) -> list[dict[str, Any]]:
    url = f"{API_BASE}/{path.lstrip('/')}"
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.get(
                url,
                params=params,
                headers={"Accept": "application/json", "User-Agent": "WindCast-Pilot/1.0"},
                timeout=(15, 90),
            )
            response.raise_for_status()
            return _unwrap(response.json())
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Elexon request failed for {path} {params}: {last_error}")


def fetch_actuals() -> list[dict[str, Any]]:
    log.info("Fetching FUELHH wind actuals for %s to %s", START_DATE, END_DATE_EXCLUSIVE)
    rows = _get_json(
        "/datasets/FUELHH/stream",
        {
            "settlementDateFrom": START_DATE,
            "settlementDateTo": END_DATE_EXCLUSIVE,
            "fuelType": "WIND",
        },
    )
    rows = [r for r in rows if str(r.get("fuelType", "")).upper() == "WIND"]
    with (DATA_DIR / "raw_actuals.json").open("w", encoding="utf-8") as f:
        json.dump(rows, f)
    log.info("Fetched %s WIND actual rows", len(rows))
    return rows


def _fetch_forecast_publish_day(publish_day: date, jan_start: pd.Timestamp, jan_end: pd.Timestamp) -> list[dict[str, Any]]:
    day_start = datetime.combine(publish_day, dtime.min, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    rows = _get_json(
        "/datasets/WINDFOR/stream",
        {
            "publishDateTimeFrom": day_start.isoformat().replace("+00:00", "Z"),
            "publishDateTimeTo": day_end.isoformat().replace("+00:00", "Z"),
        },
    )
    # Retain only forecasts whose delivery interval is in the requested January window.
    kept = []
    for row in rows:
        start = pd.to_datetime(row.get("startTime"), utc=True, errors="coerce")
        if pd.notna(start) and jan_start <= start < jan_end:
            kept.append(row)
    return kept


def fetch_forecasts() -> list[dict[str, Any]]:
    jan_start = pd.Timestamp(START_DATE, tz="UTC")
    jan_end = pd.Timestamp(END_DATE_EXCLUSIVE, tz="UTC")
    first_publish_day = (date.fromisoformat(START_DATE) - timedelta(days=FORECAST_LOOKBACK_DAYS))
    last_publish_day = date.fromisoformat(END_DATE_EXCLUSIVE)  # exclusive end
    publish_days = []
    cursor = first_publish_day
    while cursor < last_publish_day:
        publish_days.append(cursor)
        cursor += timedelta(days=1)

    log.info(
        "Fetching WINDFOR publication history (%s daily windows; %s-day lookback)",
        len(publish_days), FORECAST_LOOKBACK_DAYS,
    )
    all_rows: list[dict[str, Any]] = []
    failures: list[str] = []
    # A small worker pool speeds up the historical backfill without hammering the public API.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_fetch_forecast_publish_day, day, jan_start, jan_end): day for day in publish_days}
        for future in as_completed(futures):
            day = futures[future]
            try:
                result = future.result()
                all_rows.extend(result)
                log.info("WINDFOR %s: %s January rows", day.isoformat(), len(result))
            except Exception as exc:  # preserve the failure list so the run reports partial data accurately
                failures.append(f"{day.isoformat()}: {exc}")
                log.error("WINDFOR fetch failed for %s: %s", day, exc)

    if failures and not all_rows:
        raise RuntimeError("All WINDFOR daily requests failed. " + " | ".join(failures[:5]))
    if failures:
        log.warning("WINDFOR backfill had %s failed day(s); output may have incomplete vintage history", len(failures))

    with (DATA_DIR / "raw_forecasts.json").open("w", encoding="utf-8") as f:
        json.dump(all_rows, f)
    log.info("Fetched %s January forecast-vintage rows", len(all_rows))
    (DATA_DIR / "ingestion_warnings.txt").write_text("\n".join(failures), encoding="utf-8")
    return all_rows



def build_analysis(
    actual_rows: list[dict[str, Any]],
    forecast_rows: list[dict[str, Any]]
) -> pd.DataFrame:

    actual = pd.DataFrame(actual_rows)
    forecasts = pd.DataFrame(forecast_rows)

    if actual.empty:
        raise RuntimeError("No FUELHH WIND actual rows found.")

    if forecasts.empty:
        raise RuntimeError("No WINDFOR forecast rows found.")

    # ------------------------------------------
    # 1. PROCESS ACTUAL WIND GENERATION
    # ------------------------------------------

    actual["startTime"] = pd.to_datetime(
        actual["startTime"], utc=True, errors="coerce"
    )

    actual["publishTime"] = pd.to_datetime(
        actual.get("publishTime"), utc=True, errors="coerce"
    )

    actual["actualMW"] = pd.to_numeric(
        actual.get("generation"), errors="coerce"
    )

    actual = actual.dropna(subset=["startTime", "actualMW"])

    actual = actual[
        (actual["startTime"] >= pd.Timestamp(START_DATE, tz="UTC"))
        & (actual["startTime"] < pd.Timestamp(END_DATE_EXCLUSIVE, tz="UTC"))
    ]

    # Remove duplicate actual records.
    actual = actual.sort_values("publishTime").drop_duplicates(
        subset=["startTime"], keep="last"
    )

    # ------------------------------------------
    # 2. AGGREGATE HALF-HOURLY INTO HOURLY
    # ------------------------------------------

    actual["hourStart"] = actual["startTime"].dt.floor("h")

    actual_hourly = (
        actual.groupby("hourStart", as_index=False)
        .agg(
            actualMW=("actualMW", "mean"),
            sourceHalfHours=("actualMW", "count")
        )
    )

    # Only retain complete hours with two readings.
    actual_hourly = actual_hourly[
        actual_hourly["sourceHalfHours"] == 2
    ].copy()

    actual = actual_hourly.rename(
        columns={"hourStart": "startTime"}
    )

    # ------------------------------------------
    # 3. PROCESS FORECAST DATA
    # ------------------------------------------

    forecasts["startTime"] = pd.to_datetime(
        forecasts["startTime"], utc=True, errors="coerce"
    )

    forecasts["publishTime"] = pd.to_datetime(
        forecasts["publishTime"], utc=True, errors="coerce"
    )

    forecasts["forecastMW"] = pd.to_numeric(
        forecasts.get("generation"), errors="coerce"
    )

    forecasts = forecasts.dropna(
        subset=["startTime", "publishTime", "forecastMW"]
    )

    forecasts = forecasts[
        (forecasts["startTime"] >= pd.Timestamp(START_DATE, tz="UTC"))
        & (forecasts["startTime"] < pd.Timestamp(END_DATE_EXCLUSIVE, tz="UTC"))
    ]

    # ------------------------------------------
    # 4. SELECT DAY-AHEAD FORECAST VINTAGE
    # ------------------------------------------

    forecasts["deliveryDate"] = (
        forecasts["startTime"]
        .dt.tz_convert(LONDON)
        .dt.date.astype(str)
    )

    forecasts["decisionCutoffUTC"] = forecasts["deliveryDate"].apply(
        lambda d: (
            pd.Timestamp(
                f"{d} {DECISION_CUTOFF_LOCAL}", tz=LONDON
            ).tz_convert("UTC") - pd.Timedelta(days=1)
        )
    )

    # Only forecasts published before the decision cutoff.
    forecasts = forecasts[
        forecasts["publishTime"] <= forecasts["decisionCutoffUTC"]
    ]

    forecasts = forecasts[
        forecasts["publishTime"]
        >= forecasts["decisionCutoffUTC"]
        - pd.Timedelta(days=FORECAST_LOOKBACK_DAYS)
    ]

    # Select the latest eligible forecast for each delivery hour.
    forecasts = (
        forecasts.sort_values("publishTime")
        .drop_duplicates(subset=["startTime"], keep="last")
    )

    forecasts = forecasts[
        [
            "startTime",
            "deliveryDate",
            "publishTime",
            "forecastMW",
            "decisionCutoffUTC"
        ]
    ]

    # ------------------------------------------
    # 5. MATCH ACTUALS WITH FORECASTS
    # ------------------------------------------

    merged = actual.merge(
        forecasts,
        on="startTime",
        how="left"
    )

    merged["deliveryDate"] = (
        merged["startTime"]
        .dt.tz_convert(LONDON)
        .dt.strftime("%Y-%m-%d")
    )

    # ------------------------------------------
    # 6. CALCULATE FORECAST ERRORS
    # ------------------------------------------

    merged["errorMW"] = (
        merged["forecastMW"] - merged["actualMW"]
    )

    merged["absErrorMW"] = merged["errorMW"].abs()

    # ------------------------------------------
    # 7. PREPARE OUTPUT
    # ------------------------------------------

    merged["startTimeUTC"] = merged["startTime"].map(
        lambda x: x.isoformat()
    )

    merged["publishTimeUTC"] = merged["publishTime"].map(
        lambda x: x.isoformat() if pd.notna(x) else None
    )

    merged["decisionCutoffUTC"] = merged["decisionCutoffUTC"].map(
        lambda x: x.isoformat() if pd.notna(x) else None
    )

    output = merged[
        [
            "startTimeUTC",
            "deliveryDate",
            "publishTimeUTC",
            "decisionCutoffUTC",
            "forecastMW",
            "actualMW",
            "errorMW",
            "absErrorMW",
            "sourceHalfHours"
        ]
    ].rename(
        columns={
            "startTimeUTC": "startTime",
            "publishTimeUTC": "publishTime"
        }
    )

    output.to_csv(
        DATA_DIR / "january_2026_analysis.csv",
        index=False
    )

    return output


def run_ingestion() -> dict[str, int]:
    actual_rows = fetch_actuals()
    forecast_rows = fetch_forecasts()
    analysis = build_analysis(actual_rows, forecast_rows)
    matched = int(analysis["forecastMW"].notna().sum())
    log.info("Analysis ready: %s actual intervals, %s matched forecasts", len(analysis), matched)
    return {"actual_rows": len(actual_rows), "forecast_vintage_rows": len(forecast_rows), "intervals": len(analysis), "matched_intervals": matched}


if __name__ == "__main__":
    result = run_ingestion()
    print(json.dumps(result, indent=2))
