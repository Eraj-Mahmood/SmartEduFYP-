from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import hashlib
import json
import os
import joblib
import numpy as np
import pandas as pd
import shap
import sklearn
from pathlib import Path

app = FastAPI(title="SmartEdu Prediction Service")

MODEL_PATH = Path(__file__).parent / "smartedu_random_forest_version_a.pkl"

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Model file not found at {MODEL_PATH}. "
        "Download smartedu_random_forest_version_a.pkl from your notebook's "
        "smartedu_final_model_outputs/ folder and place it in ml_service/."
    )

package = joblib.load(MODEL_PATH)
pipeline = package["pipeline"]
FEATURE_NAMES = package["feature_names"]       # exact column order/names the model expects
TARGET_CLASSES = package["target_classes"]     # e.g. ['At-Risk', 'Dropout-Likely', 'Safe']
MODEL_VERSION = f"{package.get('model_name', 'rf')}_v{package.get('model_version', '1.0')}"
TOP_K = 5

preprocessing = pipeline.named_steps["preprocessing"]
model = pipeline.named_steps["model"]
# Inference only: thread start-up with n_jobs=-1 costs more than it saves (single row ~100 ms
# vs ~47 ms; 2000 rows ~170 ms vs ~85 ms). Predictions are identical.
model.n_jobs = 1
explainer = shap.TreeExplainer(model)          # built once; reused by every request


def _encoded_to_raw_index():
    """Map each encoded column (e.g. 'categorical__Department_AI') to the index of its
    raw source feature in FEATURE_NAMES (e.g. 'Department')."""
    columns_by_transformer = {name: list(cols) for name, _, cols in preprocessing.transformers_}
    mapping = []
    for encoded in preprocessing.get_feature_names_out():
        transformer, rest = encoded.split("__", 1)
        candidates = [c for c in columns_by_transformer[transformer]
                      if rest == c or rest.startswith(c + "_")]
        source = max(candidates, key=len)  # longest match, in case one name prefixes another
        mapping.append(FEATURE_NAMES.index(source))
    return np.array(mapping)


# Fold matrix: (n_encoded, 20). encoded_shap @ FOLD sums SHAP values per raw feature.
_ENCODED_TO_RAW = _encoded_to_raw_index()
FOLD = np.zeros((len(_ENCODED_TO_RAW), len(FEATURE_NAMES)))
FOLD[np.arange(len(_ENCODED_TO_RAW)), _ENCODED_TO_RAW] = 1.0
SAFE_INDEX = TARGET_CLASSES.index("Safe")

print(f"Loaded model: {package.get('model_name', 'unknown')} v{package.get('model_version', '?')}")
print(f"Expected features ({len(FEATURE_NAMES)}):", FEATURE_NAMES)
print(f"Target classes:", TARGET_CLASSES)


class PredictRequest(BaseModel):
    # Raw feature dict, keyed EXACTLY like the CSV/training columns, e.g.:
    # {"Semester": 5, "Department": "CS", "Gender": "Male", "Age": 21,
    #  "Attendance_Percentage": 77.9, "Assignment_Avg": 61.3, ... "Hostel": "Yes"}
    features: dict


def _to_frame(rows):
    for i, features in enumerate(rows):
        missing = [f for f in FEATURE_NAMES if f not in features]
        if missing:
            where = f" in row {i}" if len(rows) > 1 else ""
            raise HTTPException(status_code=400, detail=f"Missing required features{where}: {missing}")
    # A missing value (JSON null) becomes NaN so the pipeline's imputers fill it: SimpleImputer treats
    # NaN as missing but passes None through, which the one-hot encoder would read as an unknown category.
    return pd.DataFrame(
        [{f: (np.nan if features[f] is None else features[f]) for f in FEATURE_NAMES} for features in rows]
    )[FEATURE_NAMES]


def _json_value(v):
    v = v.item() if isinstance(v, np.generic) else v
    return None if isinstance(v, float) and np.isnan(v) else v  # NaN is not valid JSON


def predict_rows(rows):
    """Predict + explain a list of raw feature dicts. Vectorised over rows."""
    df = _to_frame(rows)
    proba = pipeline.predict_proba(df)
    encoded = preprocessing.transform(df)
    # shape (n_rows, n_encoded, n_classes) -> fold one-hot columns back to 20 raw features
    shap_encoded = np.asarray(explainer.shap_values(encoded, check_additivity=False))
    shap_raw = np.einsum("rec,ef->rfc", shap_encoded, FOLD)
    base_values = np.atleast_1d(explainer.expected_value)

    results = []
    for i in range(len(df)):
        cls = int(proba[i].argmax())
        label = TARGET_CLASSES[cls]
        contrib = shap_raw[i, :, cls]
        # Direction is risk-oriented and explains the predicted class (what the user sees).
        # For At-Risk / Dropout-Likely, a positive SHAP value pushes toward that risky class,
        # so it raises risk. For Safe, a positive SHAP value pushes toward Safe, so it lowers
        # risk, and a negative one pushes away from Safe (toward At-Risk or Dropout-Likely)
        # and raises risk. Because the class probabilities sum to 1, the Safe SHAP value is
        # exactly minus the combined At-Risk + Dropout-Likely contribution, so this is the
        # same as asking "does this feature add to total risk?".
        risk_sign = -1.0 if cls == SAFE_INDEX else 1.0
        top = np.argsort(-np.abs(contrib))[:TOP_K]
        explanations = [
            {
                "feature": FEATURE_NAMES[j],
                "value": _json_value(df.iat[i, j]),
                "shap": round(float(contrib[j]), 6),
                "direction": "raises_risk" if risk_sign * contrib[j] > 0 else "lowers_risk",
            }
            for j in top
        ]
        prob_map = {c: float(p) for c, p in zip(TARGET_CLASSES, proba[i])}
        results.append({
            "label": label,
            "prob_safe": prob_map.get("Safe", 0.0),
            "prob_at_risk": prob_map.get("At-Risk", 0.0),
            "prob_dropout": prob_map.get("Dropout-Likely", 0.0),
            "model_version": MODEL_VERSION,
            "explanations": explanations,
            "base_value": float(base_values[cls]),  # expected model output for the predicted class
        })
    return results


@app.get("/health")
def health():
    return {"status": "ok", "model": package.get("model_name"), "features_expected": FEATURE_NAMES}


# ---------------- model transparency ----------------
# Global importance = mean |SHAP| per raw feature (one-hot columns folded back), over a fixed
# sample of the dataset (IMPORTANCE_ROWS rows, random_state IMPORTANCE_SEED). It takes ~10 s, so
# it is computed once and cached in IMPORTANCE_CACHE, keyed by the model file's SHA-256 and the
# sample settings (a new model or sample recomputes it).
DATASET_CSV = Path(os.environ.get(
    "DATASET_CSV", Path(__file__).resolve().parent.parent / "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv"))
IMPORTANCE_CACHE = Path(__file__).parent / "global_importance_cache.json"
IMPORTANCE_ROWS = 2000
IMPORTANCE_SEED = 42
_importance = None


def _model_sha256():
    h = hashlib.sha256()
    with open(MODEL_PATH, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


MODEL_SHA256 = _model_sha256()


def compute_global_importance():
    """mean |SHAP| per raw feature on the fixed dataset sample (averaged over the 3 classes,
    plus per class), sorted most important first."""
    df = pd.read_csv(DATASET_CSV)
    sample = df.sample(n=min(IMPORTANCE_ROWS, len(df)), random_state=IMPORTANCE_SEED)[FEATURE_NAMES]
    encoded = preprocessing.transform(sample)
    shap_encoded = np.asarray(explainer.shap_values(encoded, check_additivity=False))
    shap_raw = np.abs(np.einsum("rec,ef->rfc", shap_encoded, FOLD))  # (rows, 20, classes)
    overall = shap_raw.mean(axis=(0, 2))
    per_class = shap_raw.mean(axis=0)  # (20, classes)
    features = [
        {
            "feature": FEATURE_NAMES[j],
            "mean_abs_shap": round(float(overall[j]), 6),
            "by_class": {c: round(float(per_class[j, k]), 6) for k, c in enumerate(TARGET_CLASSES)},
        }
        for j in np.argsort(-overall)
    ]
    return {
        "method": "mean |SHAP| per raw feature (TreeExplainer, one-hot columns summed), averaged over classes",
        "sample": {"rows": int(len(sample)), "random_state": IMPORTANCE_SEED, "source": DATASET_CSV.name},
        "model_sha256": MODEL_SHA256,
        "features": features,
    }


def global_importance():
    """Cached global importance (file cache, recomputed if the model or sample settings change)."""
    global _importance
    if _importance is not None:
        return _importance
    if IMPORTANCE_CACHE.exists():
        try:
            cached = json.loads(IMPORTANCE_CACHE.read_text(encoding="utf-8"))
            sample = cached.get("sample", {})
            if (cached.get("model_sha256") == MODEL_SHA256 and sample.get("rows") == IMPORTANCE_ROWS
                    and sample.get("random_state") == IMPORTANCE_SEED):
                _importance = cached
                return _importance
        except (ValueError, OSError):
            pass
    if not DATASET_CSV.exists():
        return None  # no dataset on this machine: model-info still works without the chart
    _importance = compute_global_importance()
    try:
        IMPORTANCE_CACHE.write_text(json.dumps(_importance, indent=1), encoding="utf-8")
    except OSError:
        pass
    return _importance


def _metrics():
    keys = ["cross_validation_macro_f1", "test_macro_f1", "test_accuracy", "best_parameters", "dataset_type"]
    return {k: package[k] for k in keys if k in package}


@app.get("/model-info")
def model_info():
    return {
        "model_name": package.get("model_name"),
        "model_type": type(model).__name__,
        "model_version": MODEL_VERSION,
        "n_estimators": getattr(model, "n_estimators", None),
        "max_depth": getattr(model, "max_depth", None),
        "feature_names": FEATURE_NAMES,
        "n_features": len(FEATURE_NAMES),
        "encoded_features": int(len(_ENCODED_TO_RAW)),
        "class_labels": TARGET_CLASSES,
        "metrics": _metrics(),
        "sklearn_version": sklearn.__version__,
        "sklearn_version_pickled": getattr(model, "_sklearn_version", None),
        "model_sha256": MODEL_SHA256,
        "global_importance": global_importance(),
    }


MAX_BATCH = 2000


class BatchPredictRequest(BaseModel):
    rows: list[dict]


@app.post("/predict")
def predict(req: PredictRequest):
    return predict_rows([req.features])[0]


@app.post("/predict/batch")
def predict_batch(req: BatchPredictRequest):
    if not req.rows:
        raise HTTPException(status_code=400, detail="rows must not be empty")
    if len(req.rows) > MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"At most {MAX_BATCH} rows per call (got {len(req.rows)})")
    return {"results": predict_rows(req.rows)}
