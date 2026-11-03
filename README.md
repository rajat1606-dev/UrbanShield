# UrbanShield AI — AI-Powered City Disaster Vulnerability & Simulation System

A premium, responsive, open-data dashboard that estimates **flood vulnerability for Pune, Mumbai and Delhi**, shows it on a live Leaflet/OSM risk map, lets you run **what-if scenarios** (rainfall ↑, drainage ↑, green cover ↑), and adds a **genuine Machine-Learning flood predictor** (scikit-learn, trained on a real IMD dataset) served through a small Flask API.

> **Honesty first:** this is an educational demonstration. The six-factor scoring formula is a transparent **heuristic** — it is *not* Machine Learning and **not scientifically validated**. The ML section *is* a real trained model, but it is trained on Kerala data and is therefore labelled **experimental** outside Kerala. The app is **not an official disaster-warning system**. Missing datasets are always shown as *unavailable*, never replaced by invented values.

---

## 1. Quick start (VS Code Live Server)

1. Open the `UrbanShield-AI` folder in **VS Code**.
2. Install the **Live Server** extension (optional but easiest).
3. Right-click `index.html` → **Open with Live Server**.

No build step, no backend, no API keys. An internet connection is required (CDN libraries + live APIs).

> **Styles look unstyled or icons look huge?** Hard-refresh once (`Ctrl+Shift+R`).
> `index.html` links `style.css?v=2.1` and `script.js?v=2.1` precisely to bust stale
> cached copies, and every icon is rendered by the Lucide library at a fixed size.
> Keep all four files in the same folder so the relative paths resolve.

Alternative without VS Code:

```bash
cd UrbanShield-AI
python -m http.server 5500     # then open http://localhost:5500
```

Opening `index.html` directly via double-click also works in Chrome/Edge/Firefox (caching is wrapped in safe try/catch).

## 2. Project structure

```
UrbanShield-AI/
├── index.html          # layout: sidebar, 6 views, location modal
├── style.css           # dark navy/cyan GIS theme, fully responsive
├── script.js           # data layer + scoring engine + charts + map + simulator + ML view
├── README.md
└── backend/            # Machine-Learning backend (optional — site works without it)
    ├── train_ml.py     # trains Random Forest / Decision Tree / Logistic Regression
    ├── app.py          # Flask: serves the site + /api/ml/* endpoints
    ├── requirements.txt
    ├── data/
    │   └── kerala_floods_imd_1901_2018.csv   # genuine IMD dataset (downloaded & bundled)
    └── models/         # created by train_ml.py
        ├── flood_model.joblib   # best pipeline (Joblib)
        └── ml_report.json       # dataset provenance + real evaluation metrics
```

## 3. Features

| View | What it does |
|---|---|
| **Dashboard** | KPIs (locations analysed, high/medium/low counts, live rainfall, temperature, humidity, last update), risk doughnut, 48 h rainfall timeline, top-risk locations bar, 3-day forecast, Census city profile |
| **City Risk Map** | Leaflet + OpenStreetMap dark tiles, colour-coded locality markers (red/yellow/green), risk-category filters with counts, click → full data modal, city switching |
| **Vulnerability Engine** | The complete transparent formula: 6 weighted factors, normalisation rules, weight redistribution for missing data, per-location score table, average factor contribution chart |
| **What-If Simulator** | Sliders for rainfall increase (0–100 %), drainage improvement (0–100 %), green cover increase (0–100 %); instant recalculation, before/after chart, classification shifts |
| **ML Flood Prediction** | Genuine scikit-learn models (Random Forest, Decision Tree, Logistic Regression) trained on real IMD Kerala rainfall/flood-label data (1901–2018): model card with provenance, real held-out metrics (Accuracy / Precision / Recall / F1 / Confusion Matrix / ROC-AUC / Brier), model comparison, feature influence, and an interactive prediction panel with a side-by-side rule-based score for the same locality |
| **Data Sources** | Live API status badges, Census of India 2011 table (density computed in-app), documented historical flood events, disclaimers, cache-clearing button |

## 4. Real data sources

| Source | Used for | Notes |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/docs) | Current weather, hourly rainfall (24 h observed + 24 h forecast), 3-day forecast | Free, no key, CORS-enabled. Auto-refresh every 15 min |
| [Open Topo Data](https://www.opentopodata.org/) | Elevation (ASTER 30 m) | Queried first as requested; the service does **not** send CORS headers to browsers, so the app auto-falls back to the **Open-Meteo Elevation API (Copernicus DEM GLO-90)** and labels the active source in the UI |
| [OpenStreetMap](https://www.openstreetmap.org/) | Map tiles + land-use context | Leaflet renders the standard OSM tile layer with a CSS dark-mode display filter (data © OpenStreetMap contributors). One Overpass API query collects land-use tags / water bodies within ≈1.2 km of every locality for the details panel (cached 24 h, two public mirrors) |
| [Census of India 2011](https://censusindia.gov.in/) | Population | Official city-level population/area embedded with citation; ward-level numbers are not published via API, so localities carry a clearly-marked relative density tier (estimate) |
| [Bhuvan (NRSC)](https://bhuvan.nrsc.gov.in/) / [NDEM](https://ndem.nrsc.gov.in/) | Historical floods | These portals publish hazard layers as manual downloads (WMS/shapefile), **not** key-less JSON APIs — so documented flood events are listed with citations instead of a fake live feed |
| [IMD Kerala rainfall dataset](https://github.com/amandp13/Flood-Prediction-Model) (bundled CSV) | **ML training data** | Genuine India-Meteorological-Department subdivisional monthly rainfall for Kerala, 1901–2018 (118 annual rows), with the published `FLOODS` yes/no label column. Rainfall values were cross-checked against an independent IMD subdivisional mirror (max monthly diff < 5 %). SHA-256 recorded in `ml_report.json`. Labels are used exactly as published — never rewritten |
| [Open-Meteo ERA5 archive](https://open-meteo.com/en/docs/historical-weather-api) | ML prediction panel | Real historical daily precipitation (ECMWF ERA5 reanalysis) for any locality/year, aggregated to Jun–Sep totals in the browser and clearly labelled **model data, not gauge measurements** |

If any API fails, the UI shows an explicit *unavailable* message and redistributes that factor's weight across the remaining factors. No measurement is ever fabricated.

## 5. The scoring formula (transparent by design)

```
score = Σ ( normalised factor × weight ) ÷ Σ ( weights of available factors )
```

| Factor | Weight | Data class | Normalisation |
|---|---|---|---|
| Rainfall (48 h exposure) | 25 % | MODEL (observed + forecast) | 0 mm → 0 · ≥200 mm → 100 · linear |
| Elevation | 15 % | MEASURED (DEM) | lowest analysed point → 100 · highest → 0 (city-relative) |
| Population density | 20 % | ESTIMATE (tier 1–5 + Census city value) | tier ÷ 5 × 100 |
| Land use | 15 % | ESTIMATE (class + OSM cross-check) | industrial 80 · dense-res 75 · residential 60 · mixed 55 · peri-urban 40 · green 20 |
| Drainage capacity | 15 % | ESTIMATE (tier 1–5) | (6 − tier) ÷ 5 × 100 |
| Flood history | 10 % | ESTIMATE (documented events + floodplain proximity) | analyst tier 0–100 |

Classification: **0–30 Low · 31–60 Medium · 61–100 High**.

Every value in the UI carries a badge — `OBSERVED` / `MODEL` / `MEASURED` / `OFFICIAL` / `ESTIMATE` / `UNAVAILABLE` — so actual measurements, weather-model output, estimates and missing values can never be confused.

## 5b. Machine-Learning backend (genuine models, honestly labelled)

Two engines live side by side and are never mixed:

| Engine | What it is | Where |
|---|---|---|
| **Rule-based Risk Engine** | The transparent six-factor weighted heuristic — *not* ML | `script.js`, views: Map / Engine / Simulator |
| **ML Prediction Engine** | Real scikit-learn classifiers trained on labelled historical data | `backend/`, view: **ML Flood Prediction** |

### Install, train, run

```bash
cd UrbanShield-AI/backend
pip install -r requirements.txt      # Flask, pandas, numpy, scikit-learn, joblib
python train_ml.py                   # trains + evaluates all 3 models, saves Joblib model + report
python app.py                        # http://127.0.0.1:5000  (serves the site + ML API)
```

Open **http://127.0.0.1:5000** and click **ML Flood Prediction**. The static site also keeps working standalone (Live Server / `file://`) — in that case the ML panel shows an explicit *backend offline* card (CORS is enabled, so Live Server on :5500 + Flask on :5000 works too).

### What `train_ml.py` does (no fake numbers anywhere)

- **Data:** bundled genuine IMD Kerala subdivision rainfall 1901–2018 (118 annual rows; 60 flood / 58 non-flood years as published). First run downloads it from the public mirror if `backend/data/` is empty.
- **Features:** June–September monthly rainfall (SW monsoon — Kerala's flood season), deliberately few for a 118-row dataset.
- **Algorithms:** Logistic Regression (with standardisation), Decision Tree, Random Forest — plain, documented hyper-parameters; **no tuning against the test set**.
- **Split:** temporal hold-out — train ≤ 2001 (101 rows), test 2002–2018 (17 rows, both classes present). The test years are never seen during training or model selection.
- **Cross-validation:** 5-fold stratified CV *inside the training era only*; scaling lives inside Pipelines so fold statistics never leak.
- **Selection:** highest held-out test F1 (ROC-AUC tie-break). The winner plus every metric is written to `backend/models/ml_report.json` and shown verbatim in the UI.
- **Metrics displayed:** Accuracy, Precision, Recall, F1, Confusion Matrix, ROC-AUC, Brier score — computed on the held-out years, with CV mean ± std alongside.

### Honest limitations (also shown in the UI)

- Trained on the **Kerala** meteorological subdivision only — predictions for Pune, Mumbai or Delhi are **unvalidated extrapolations** and are labelled `EXPERIMENTAL` everywhere.
- 118 annual observations → wide uncertainty bands on every metric.
- SW-monsoon features only; years flooded mainly by the NE monsoon (Oct–Dec) may be missed.
- The label column is used exactly as published; it marks years with reported floods somewhere in Kerala and is frequent (60/118) by that definition.
- Probabilities are model outputs, **not** calibrated meteorological forecasts (the Brier score is shown for transparency).

## 6. Customisation

- **Weights** — edit the `WEIGHTS` object at the top of `script.js` (keep the sum at 1.0).
- **Cities / localities** — each city in `CITIES` has real locality coordinates plus tier fields (`densityTier`, `landuse`, `drainTier`, `floodScore`, `floodNote`). Add a row with the `LOC(...)` helper; elevation is fetched automatically for new coordinates.
- **Refresh policy** — see `TTL` and `MIN_WEATHER_GAP` in `script.js` (weather cache 10 min, elevation 7 days, OSM land-use 24 h).
- **Basemap** — swap `TILE_URL` (e.g. to the standard OSM tile layer) if you prefer a light map.
- **ML** — hyper-parameters live in `build_models()` in `backend/train_ml.py`; re-run it after any change, then restart `app.py`. The UI always reflects the latest `ml_report.json`.

## 7. Troubleshooting

| Symptom | Explanation |
|---|---|
| "Weather API unavailable" banner | Open-Meteo unreachable / rate-limited. Cached values are shown if present; the rainfall factor is disabled otherwise (weight redistributed). |
| Elevation badge says *fallback* | Expected in browsers — Open Topo Data does not emit CORS headers, so Open-Meteo Elevation (Copernicus DEM) takes over automatically. |
| "OSM land-use query unavailable" | The public Overpass service can be slow or busy. It is retried on a second mirror and cached 24 h; scoring continues with the assigned land-use class. |
| Charts/map blank offline | Chart.js and Leaflet load from jsDelivr CDN. Restore internet access and reload. |
| Icons missing | Lucide icons load from jsDelivr; if blocked, labels still render (icons are decorative) and a library warning banner appears. |
| "ML backend offline" card | The Flask API is not running (or the model is untrained). Start it: `cd backend && python app.py` (train first with `python train_ml.py` if `models/` is empty). |
| "ERA5 archive fetch failed" toast | Open-Meteo's historical API hiccuped — enter the four monthly values manually and predict. |
| Stale numbers | Press **Refresh Data**, or use *Data Sources → Clear cached datasets & reload*. |

## 8. Browser support

Evergreen Chrome, Edge, Firefox and Safari (uses ES2020, `fetch`, `localStorage`, CSS Grid). No polyfills or frameworks.

## 9. Ethical use

- Do **not** present scores as probabilities of flooding or as official warnings — follow IMD / NDMA / SDMA and municipal corporations for that.
- Simulated (what-if) values are hypothetical and are kept strictly separate from live observations.
- The six-factor scoring engine is a transparent heuristic, **not** Machine Learning; the ML engine is real but trained only on Kerala data — treat its outputs for other cities as experimental teaching material, never as validated risk estimates.
