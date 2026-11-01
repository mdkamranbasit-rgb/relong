from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

API_BASE = "https://data.elexon.co.uk/bmrs/api/v1"
START_DATE = os.getenv("START_DATE", "2026-01-02")
END_DATE_EXCLUSIVE = os.getenv("END_DATE_EXCLUSIVE", "2026-02-02")
DECISION_CUTOFF_LOCAL = os.getenv("DECISION_CUTOFF_LOCAL", "10:00")
FORECAST_LOOKBACK_DAYS = int(os.getenv("FORECAST_LOOKBACK_DAYS", "14"))
