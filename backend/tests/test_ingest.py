import pandas as pd

from app.ingest import build_analysis
from app.analytics import calculate_metrics


def test_selects_latest_forecast_available_before_cutoff(tmp_path, monkeypatch):
    import app.ingest as ingest
    monkeypatch.setattr(ingest, "DATA_DIR", tmp_path)

    actuals = [
    {
        "startTime": "2026-01-15T09:00:00Z",
        "publishTime": "2026-01-15T09:35:00Z",
        "fuelType": "WIND",
        "generation": 5000,
    },
    {
        "startTime": "2026-01-15T09:30:00Z",
        "publishTime": "2026-01-15T10:05:00Z",
        "fuelType": "WIND",
        "generation": 5000,
    },
]
    forecasts = [
        {"startTime": "2026-01-15T09:00:00Z", "publishTime": "2026-01-14T08:30:00Z", "generation": 5100},
        {"startTime": "2026-01-15T09:00:00Z", "publishTime": "2026-01-14T09:45:00Z", "generation": 5200},
        # This revision is after the D-1 10:00 GMT cutoff and must not be selected.
        {"startTime": "2026-01-15T09:00:00Z", "publishTime": "2026-01-14T10:30:00Z", "generation": 5300},
    ]

    result = build_analysis(actuals, forecasts)
    assert len(result) == 1
    assert result.iloc[0]["forecastMW"] == 5200
    assert result.iloc[0]["actualMW"] == 5000
    assert result.iloc[0]["errorMW"] == 200


def test_accuracy_metrics():
    frame = pd.DataFrame({
        "forecastMW": [110.0, 90.0],
        "actualMW": [100.0, 100.0],
    })
    metrics = calculate_metrics(frame)
    assert metrics["mae"] == 10.0
    assert metrics["rmse"] == 10.0
    assert metrics["bias"] == 0.0
    assert metrics["wape"] == 10.0
    assert metrics["coverage"] == 100.0
