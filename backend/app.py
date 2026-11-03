# =========================================================================
# UrbanShield AI — app.py (Flask backend for the ML Flood Prediction view)
#
#   1. Serves the existing static site (index.html / style.css / script.js)
#      from the project root, so the whole app runs from one origin.
#   2. Exposes a small JSON API around the model trained by train_ml.py:
#        GET  /api/ml/info      -> real dataset/training report (metrics…)
#        GET  /api/ml/examples  -> two genuine dataset rows for quick-fill
#        POST /api/ml/predict   -> Flood / No Flood + probability + factors
#
#   Run:  python app.py        (then open http://127.0.0.1:5000)
#   The static site keeps working standalone (Live Server / file://) —
#   the ML view simply shows a clear "backend offline" state.
#   CORS is enabled so the site can also be opened from Live Server
#   (port 5500) while Flask runs alongside on 5000.
# =========================================================================

import os
from pathlib import Path

import joblib
import numpy as np
from flask import Flask, jsonify, request, send_from_directory

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                      # UrbanShield-AI/  (static site root)
MODEL_FILE = HERE / "models" / "flood_model.joblib"
REPORT_FILE = HERE / "models" / "ml_report.json"

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")

FEATURES = ["JUN", "JUL", "AUG", "SEP"]
FEATURE_LABELS = {
    "JUN": "June rainfall", "JUL": "July rainfall",
    "AUG": "August rainfall", "SEP": "September rainfall",
}
MAX_MM = 5000.0                          # sanity bound for one month (Cherrapunji-scale)

_state = {"model": None, "report": None}


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.after_request
def add_cors(resp):
    return _cors(resp)


def load_ml():
    """Load the trained artefacts once; return (model, report) or (None, error)."""
    if _state["model"] is not None:
        return _state["model"], _state["report"], None
    if not MODEL_FILE.exists() or not REPORT_FILE.exists():
        return None, None, ("Model not trained yet. Run:  python backend/train_ml.py  "
                            "(then restart this server).")
    _state["model"] = joblib.load(MODEL_FILE)
    import json
    _state["report"] = json.loads(REPORT_FILE.read_text())
    return _state["model"], _state["report"], None


@app.route("/")
def index():
    return send_from_directory(str(ROOT), "index.html")


@app.route("/api/ml/info")
def ml_info():
    model, report, err = load_ml()
    if err:
        return jsonify({"status": "untrained", "error": err}), 503
    return jsonify({"status": "ready", "report": report})


@app.route("/api/ml/examples")
def ml_examples():
    _, report, err = load_ml()
    if err:
        return jsonify({"status": "untrained", "error": err}), 503
    return jsonify({"status": "ready", "examples": report["examples"],
                    "features": report["features"]})


@app.route("/api/ml/predict", methods=["POST"])
def ml_predict():
    model, report, err = load_ml()
    if err:
        return jsonify({"status": "untrained", "error": err}), 503

    payload = request.get_json(silent=True) or {}
    values, bad = {}, []
    for f in FEATURES:
        v = payload.get(f, None)
        try:
            v = float(v)
        except (TypeError, ValueError):
            bad.append(f)
            continue
        if not np.isfinite(v) or v < 0 or v > MAX_MM:
            bad.append(f)
            continue
        values[f] = v
    if bad:
        return jsonify({"status": "invalid_input",
                        "error": f"Provide monthly rainfall in mm (0–{MAX_MM:.0f}) for: {', '.join(bad)}"}), 400

    X = np.array([[values[f] for f in FEATURES]])
    prob = float(model.predict_proba(X)[0, 1])
    pred = int(prob >= 0.5)

    # Honest, simple explanation: this input vs training-partition class means.
    prof = report["class_profile_mm"]
    factors = []
    for f in FEATURES:
        flood_m, no_m = prof["flood"][f], prof["no_flood"][f]
        factors.append({
            "key": f, "label": FEATURE_LABELS[f], "value_mm": round(values[f], 1),
            "flood_year_mean_mm": flood_m, "no_flood_year_mean_mm": no_m,
            "importance": report["importance"]["values"].get(f),
        })
    factors.sort(key=lambda d: abs((d["value_mm"] - d["no_flood_year_mean_mm"]))
                 * float(d["importance"] or 0), reverse=True)

    return jsonify({
        "status": "ready",
        "model": report["selected_model"],
        "prediction": "Flood" if pred == 1 else "No Flood",
        "probability_flood": round(prob, 4),
        "threshold": 0.5,
        "brier": report["comparison"][0]["test"].get("brier") if report["comparison"] else None,
        "factors": factors,
        "context": {k: payload.get(k) for k in ("city", "locality", "year") if payload.get(k)},
        "experimental": True,
        "note": ("Trained on IMD Kerala subdivision rainfall 1901-2018. Predictions for other "
                 "cities are unvalidated extrapolations, provided for education only."),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"UrbanShield AI backend  →  http://127.0.0.1:{port}")
    print("Static site served from the project root; ML API under /api/ml/*")
    app.run(host="127.0.0.1", port=port, debug=False)
