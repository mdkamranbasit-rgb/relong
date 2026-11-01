# WindCast — 10-minute demo guide

Keep the recording under 10 minutes. Show the deployed app in a private/incognito browser window and keep the README/GitHub repo ready in another tab. Replace the bracketed values with the actual values shown by your data run. Never read out sample numbers if the API did not return them.

## Part 1 — Client pitch (0:00–4:50)

**0:00–0:35 | Business context**

“Wind generation is weather-dependent. The purchasing team has to make day-ahead decisions using forecasts that are available before its decision cutoff. WindCast brings those forecasts and the eventual metered output into one place so the team can assess both expected generation and forecast uncertainty.”

**0:35–1:40 | Overview**

“Here is the January 2026 national wind overview. The key measures are MAE, WAPE, forecast bias and matched-interval coverage. MAE tells us the average miss in MW; WAPE scales total absolute error against total actual generation; bias tells us whether the forecast tends to over- or under-estimate.”

Point to the forecast-versus-actual trend and daily performance table.

**1:40–2:50 | Accuracy**

“On the accuracy page, we show month-level metrics and daily error variation. This lets the team see whether a single monthly average hides days with materially higher uncertainty.”

**2:50–4:10 | Forecast explorer**

“Here I can select a delivery date and inspect all 48 half-hourly settlement intervals. Each row shows the forecast selected for the day-ahead decision, actual generation, signed error and forecast publication time. This makes the data traceable rather than presenting only an opaque score.”

**4:10–4:50 | Business value and boundary**

“WindCast gives the team a transparent view of expected wind contribution and historical forecast error. This pilot is intentionally limited to the two Elexon feeds in the brief. It does not calculate total procurement volume because demand and other generation sources are outside the agreed dataset scope.”

## Part 2 — Technical review / knowledge transfer (4:50–9:50)

**4:50–5:45 | Architecture**

“React and Recharts provide the dashboard. FastAPI exposes a small set of JSON endpoints. A Python/Pandas ingestion pipeline calls Elexon FUELHH for WIND actuals and WINDFOR for forecast vintages. The processed matched intervals are stored as a local CSV snapshot so the dashboard reads a consistent dataset.”

Show the README architecture diagram and repository tree.

**5:45–7:00 | Data pipeline and vintage logic**

“FUELHH is filtered to fuelType WIND. WINDFOR has both startTime and publishTime. startTime identifies the delivery interval; publishTime tells us when that forecast version became available. For each delivery interval, the pipeline selects the latest publishTime no later than 10:00 Europe/London on D−1. The brief did not provide the client’s precise operational cutoff, so 10:00 is an explicit configurable pilot assumption. The ingestion keeps a 14-day publication lookback.”

Show `backend/app/ingest.py`, especially `fetch_forecasts` and `build_analysis`.

**7:00–8:00 | Metrics**

“After selecting one eligible forecast per interval, we join it to actual generation by startTime. We calculate MAE, RMSE, mean signed bias and WAPE only on intervals where both forecast and actual exist. Coverage is surfaced separately; we do not silently fill missing values.”

Show `backend/app/analytics.py` and the tests.

**8:00–8:55 | API and frontend**

“The API separates monthly overview, day-level series, status and refresh operations. The React frontend consumes those endpoints and provides overview, accuracy and explorer views. The date explorer also exports the selected day’s interval data to CSV.”

Show FastAPI `/docs` and the frontend briefly.

**8:55–9:30 | Engineering practices**

“The project includes dependency pinning, environment-based configuration, request timeouts and retries, bounded concurrent daily requests, Dockerfiles, Docker Compose, health checks and automated tests for the cutoff selection and metric calculation. AI assistance is disclosed in the README.”

**9:30–9:50 | Limitations and next step**

“The two key assumptions to confirm with the client are the exact day-ahead decision cutoff and the required lookback horizon. For production, I would persist raw source data and processed vintages in a database, add scheduled refresh/monitoring, and restrict CORS to the deployed frontend. I would not claim a procurement quantity until demand and the other required generation inputs are available.”
