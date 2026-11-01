from __future__ import annotations

from pathlib import Path
import math
import pandas as pd

from .config import DATA_DIR

DATA_FILE = DATA_DIR / "january_2026_analysis.csv"


def load_data() -> pd.DataFrame:
    if not DATA_FILE.exists():
        return pd.DataFrame()
    df = pd.read_csv(DATA_FILE)
    if df.empty:
        return df
    for col in ("forecastMW", "actualMW", "errorMW", "absErrorMW"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["startTimeParsed"] = pd.to_datetime(df["startTime"], utc=True, errors="coerce")
    return df


def calculate_metrics(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"mae": None, "rmse": None, "bias": None, "wape": None, "coverage": 0, "intervals": 0}
    valid = df.dropna(subset=["forecastMW", "actualMW"])
    if valid.empty:
        return {"mae": None, "rmse": None, "bias": None, "wape": None, "coverage": 0, "intervals": 0}
    errors = valid["forecastMW"] - valid["actualMW"]
    denominator = valid["actualMW"].abs().sum()
    return {
        "mae": round(float(errors.abs().mean()), 1),
        "rmse": round(float(math.sqrt((errors ** 2).mean())), 1),
        "bias": round(float(errors.mean()), 1),
        "wape": round(float(errors.abs().sum() / denominator * 100), 2) if denominator else None,
        "coverage": round(float(len(valid) / len(df) * 100), 1),
        "intervals": int(len(valid)),
    }


def overview_payload(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"hasData": False, "metrics": calculate_metrics(df), "daily": [], "dataInfo": {}}
    metrics = calculate_metrics(df)
    valid = df.dropna(subset=["forecastMW", "actualMW"]).copy()
    daily = []
    if not valid.empty:
        for day, group in valid.groupby("deliveryDate", sort=True):
            daily.append({
                "date": day,
                "forecastMW": round(float(group["forecastMW"].mean()), 1),
                "actualMW": round(float(group["actualMW"].mean()), 1),
                "maeMW": round(float(group["errorMW"].abs().mean()), 1),
                "intervals": int(len(group)),
            })
    avg_forecast = round(float(valid["forecastMW"].mean()), 1) if not valid.empty else None
    avg_actual = round(float(valid["actualMW"].mean()), 1) if not valid.empty else None
    latest_publish = valid["publishTime"].dropna().max() if not valid.empty else None
    return {
        "hasData": True,
        "metrics": metrics,
        "daily": daily,
        "dataInfo": {
            "actualIntervals": int(len(df)),
            "matchedIntervals": int(len(valid)),
            "averageForecastMW": avg_forecast,
            "averageActualMW": avg_actual,
            "latestSelectedPublishTime": latest_publish,
            "startDate": str(df["deliveryDate"].min()),
            "endDate": str(df["deliveryDate"].max()),
        },
    }


def series_payload(df: pd.DataFrame, delivery_date: str) -> dict:
    if df.empty:
        return {"date": delivery_date, "rows": [], "metrics": calculate_metrics(df)}
    subset = df[df["deliveryDate"] == delivery_date].sort_values("startTimeParsed").copy()
    rows = []
    for _, row in subset.iterrows():
        ts = row.get("startTimeParsed")
        local_time = ts.tz_convert("Europe/London").strftime("%H:%M") if pd.notna(ts) else "--:--"
        rows.append({
            "time": local_time,
            "startTime": row.get("startTime"),
            "forecastMW": None if pd.isna(row.get("forecastMW")) else round(float(row["forecastMW"]), 1),
            "actualMW": None if pd.isna(row.get("actualMW")) else round(float(row["actualMW"]), 1),
            "errorMW": None if pd.isna(row.get("errorMW")) else round(float(row["errorMW"]), 1),
            "publishTime": None if pd.isna(row.get("publishTime")) else row.get("publishTime"),
        })
    return {"date": delivery_date, "rows": rows, "metrics": calculate_metrics(subset)}
