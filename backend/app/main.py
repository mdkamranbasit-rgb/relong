from __future__ import annotations

import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analytics import DATA_FILE, calculate_metrics, load_data, overview_payload, series_payload
from .ingest import run_ingestion

app = FastAPI(
    title="WindCast API",
    description="January 2026 UK national wind generation forecast monitoring and accuracy analytics.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to the deployed Vercel origin for production.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ingestion_lock = threading.Lock()
_ingestion_state = {"state": "idle", "message": "Ready", "result": None}


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "windcast-api", "version": "1.0.0"}


@app.get("/api/status")
def status():
    return {**_ingestion_state, "hasData": DATA_FILE.exists()}


def _run_ingestion_in_background():
    try:
        _ingestion_state.update({"state": "running", "message": "Downloading Elexon data and calculating metrics", "result": None})
        result = run_ingestion()
        _ingestion_state.update({"state": "complete", "message": "January 2026 data is ready", "result": result})
    except Exception as exc:
        _ingestion_state.update({"state": "failed", "message": str(exc), "result": None})
    finally:
        _ingestion_lock.release()


@app.post("/api/refresh")
def refresh():
    if not _ingestion_lock.acquire(blocking=False):
        return {"state": "running", "message": "A data refresh is already running"}
    _ingestion_state.update({"state": "queued", "message": "Data refresh started", "result": None})
    thread = threading.Thread(target=_run_ingestion_in_background, daemon=True)
    thread.start()
    return {"state": "running", "message": "Data refresh started"}


@app.get("/api/overview")
def overview():
    df = load_data()
    return overview_payload(df)


@app.get("/api/series")
def series(delivery_date: str = Query(default="2026-01-15", alias="date")):
    df = load_data()
    if df.empty:
        raise HTTPException(status_code=404, detail="No analysis data found. Run the January 2026 data refresh first.")
    if delivery_date < "2026-01-01" or delivery_date >= "2026-02-01":
        raise HTTPException(status_code=400, detail="Date must be in January 2026.")
    return series_payload(df, delivery_date)


@app.get("/api/dates")
def dates():
    df = load_data()
    if df.empty:
        return {"dates": []}
    return {"dates": sorted(df["deliveryDate"].dropna().unique().tolist())}
