# WindCast — UK Wind Forecast Intelligence

A full-stack pilot dashboard for reviewing national UK wind generation forecasts and evaluating forecast accuracy for January 2026. Built with React, FastAPI/Python, Pandas and Docker.

> **Scope:** This pilot uses only Elexon BMRS `FUELHH` (WIND actual generation) and `WINDFOR` (wind forecast vintages). It does not train a prediction model. It evaluates the forecasts already published by Elexon. Since no demand or non-wind generation data is included, this application does not calculate a complete electricity procurement requirement.

## Features

- Overview of daily average wind forecast vs actual generation.
- Day-ahead forecast vintage selection: latest `WINDFOR` publication available by the configured D−1 decision cutoff.
- Accuracy metrics: MAE, RMSE, mean bias error and WAPE.
- Daily and half-hourly forecast explorer with publication timestamps.
- CSV export for an individual delivery day.
- Elexon data refresh from the UI or Python CLI.
- Docker Compose for local full-stack execution.

## Architecture

```text
Elexon BMRS public API
  ├── FUELHH/stream  (fuelType=WIND actuals)
  └── WINDFOR/stream (publish-time forecast vintages)
           │
           ▼
Python ingestion + Pandas analytics
  ├── timestamp normalization (UTC)
  ├── day-ahead vintage selection
  ├── actual/forecast interval join
  └── MAE / RMSE / bias / WAPE
           │
           ▼
CSV analytical snapshot (backend/data)
           │
           ▼
FastAPI JSON endpoints  ◄──── React + Recharts dashboard
```

### Day-ahead selection assumption

The assignment says decisions are made one day before delivery but does not specify the team's exact operational gate/decision timestamp. For this pilot, the configurable cutoff is **10:00 Europe/London on D−1**. January 2026 is on GMT (UTC+0). For each delivery interval, the application selects the latest `publishTime` not later than that cutoff. The ingestion fetches a 14-day publication lookback to include earlier forecast vintages. Both settings can be changed using `DECISION_CUTOFF_LOCAL` and `FORECAST_LOOKBACK_DAYS`.

This cutoff is an explicit modelling assumption for the pilot, not a claim that it is the client's confirmed internal deadline. Confirm it with the client before operational use.

## Data sources

- Actual wind generation: `https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream?settlementDateFrom=2026-01-01&settlementDateTo=2026-02-01&fuelType=WIND`
- Wind forecast vintages: `https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream` filtered using `publishDateTimeFrom` and `publishDateTimeTo`.
- API documentation: https://bmrs.elexon.co.uk/api-documentation

Elexon states the API is public and does not require an API key. The ingestion requests WINDFOR by daily publication windows to keep requests bounded, then retains forecast rows whose `startTime` falls in January 2026.

## Run locally (without Docker)

Requirements: Python 3.11+, Node.js 20+.

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
python -m app.ingest
uvicorn app.main:app --reload --port 8000
```

The first ingestion downloads actuals and forecast history from Elexon. It may take a few minutes because forecast publication history is fetched in daily windows. It writes the processed analytical snapshot to `backend/data/january_2026_analysis.csv`.

### 2. Frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. FastAPI docs are available at http://localhost:8000/docs.

You can also use **Refresh data** in the dashboard to start ingestion and watch its status.

## Run with Docker

From the repository root:

```bash
docker compose up --build
```

Open http://localhost:5173. The API is at http://localhost:8000 and docs at http://localhost:8000/docs.

Run the initial data ingestion from another terminal:

```bash
docker compose exec backend python -m app.ingest
```

The `backend/data` directory is mounted as a volume so the generated CSV snapshot persists on the host.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API health check |
| GET | `/api/status` | Ingestion state and snapshot availability |
| POST | `/api/refresh` | Start an asynchronous Elexon data refresh |
| GET | `/api/overview` | Monthly metrics and daily aggregates |
| GET | `/api/series?date=2026-01-15` | 48 half-hourly rows for a delivery date |
| GET | `/api/dates` | Dates present in the snapshot |

## Metrics

For each matched interval, `error = forecast − actual`.

- **MAE:** mean of absolute errors, in MW.
- **RMSE:** square root of mean squared error, in MW.
- **Bias:** mean signed error, in MW. Positive means over-forecast.
- **WAPE:** sum of absolute errors divided by sum of absolute actual generation, expressed as a percentage.

Intervals without both an eligible day-ahead forecast and an actual are excluded from the metric calculation. Forecast coverage is reported separately. WAPE is used instead of MAPE to avoid division by near-zero actual values at individual intervals.

## Repository structure

```text
windcast-project/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── analytics.py       # Accuracy calculations and API response shaping
│   │   ├── config.py          # Data range and decision-cutoff configuration
│   │   ├── ingest.py          # Elexon API ingestion and forecast-vintage selection
│   │   └── main.py            # FastAPI routes and refresh status
│   ├── data/                  # Processed CSV snapshot and raw local cache
│   ├── tests/
│   │   └── test_ingest.py    # Forecast cutoff and metric tests
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Dashboard pages and API integration
│   │   ├── main.jsx           # React entry point
│   │   └── styles.css         # Responsive dashboard styling
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
├── docker-compose.yml
├── render.yaml
└── README.md
```

## Deployment

The frontend is a Vite static site and can be deployed to **Vercel**. The FastAPI service can be deployed separately as a Docker web service (for example, Render). This satisfies the pilot deployment requirement with a Vercel-hosted application UI and a separately hosted Python API.

### Backend (Render)

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository and use `render.yaml`, or create a Docker web service with Dockerfile path `backend/Dockerfile` and Docker context `backend`.
3. Deploy and copy the service URL, e.g. `https://your-windcast-api.onrender.com`.
4. Before the demo, make sure `backend/data/january_2026_analysis.csv` is populated and committed, or run the ingestion from a persistent service shell/volume.

### Frontend (Vercel)

1. Import the same GitHub repository into Vercel.
2. Set the project root directory to `frontend`.
3. Add environment variable `VITE_API_URL=https://your-windcast-api.onrender.com` (no trailing slash).
4. Deploy. Test the deployed page and the backend `/api/health` URL in a private/incognito window.

For a fast pilot deployment, generate the CSV snapshot locally with `python -m app.ingest` before pushing. Do not commit raw JSON caches; they are ignored by `.gitignore`. The processed CSV is intentionally allowed to be committed for a reproducible demo snapshot.

## Automated tests

From the `backend` directory, run `pytest -q`. The tests verify the D−1 cutoff selection and the core accuracy metric calculations.

## Testing checklist

- `GET /api/health` returns `{"status":"ok", ...}`.
- `GET /api/overview` returns `hasData: true` after ingestion.
- `GET /api/series?date=2026-01-15` returns up to 48 half-hourly periods.
- Confirm at least some matched intervals exist and review the `ingestion_warnings.txt` file for failed publication days.
- Confirm the Vercel URL and API health URL open without authentication in a private/incognito window.

## Known limitations / assumptions

- The decision cutoff (D−1 10:00 UK) is an explicit pilot assumption because the brief does not give the client's precise cutoff.
- A 14-day forecast-publication lookback is used; confirm the maximum required forecast lead with the client/data documentation if broader vintages are needed.
- The pilot is national aggregate wind only; it does not include demand, solar, other generation, prices, imbalance costs or plant constraints.
- Elexon data availability and missing intervals can affect forecast coverage; the dashboard reports matched coverage rather than silently imputing values.
- This tool is decision support and forecast-quality monitoring, not an automated trading or dispatch system.

## AI assistance disclosure

AI tools (ChatGPT) were used to assist with domain decomposition, initial code scaffolding, documentation, and UI implementation. API field definitions and data-selection assumptions are documented above; the implementation should be reviewed and tested against the live Elexon API before operational use.
