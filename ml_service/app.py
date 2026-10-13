from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import pandas as pd
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

print(f"Loaded model: {package.get('model_name', 'unknown')} v{package.get('model_version', '?')}")
print(f"Expected features ({len(FEATURE_NAMES)}):", FEATURE_NAMES)
print(f"Target classes:", TARGET_CLASSES)


class PredictRequest(BaseModel):
    # Raw feature dict, keyed EXACTLY like the CSV/training columns, e.g.:
    # {"Semester": 5, "Department": "CS", "Gender": "Male", "Age": 21,
    #  "Attendance_Percentage": 77.9, "Assignment_Avg": 61.3, ... "Hostel": "Yes"}
    features: dict


@app.get("/health")
def health():
    return {"status": "ok", "model": package.get("model_name"), "features_expected": FEATURE_NAMES}


@app.post("/predict")
def predict(req: PredictRequest):
    missing = [f for f in FEATURE_NAMES if f not in req.features]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required features: {missing}")

    row = pd.DataFrame([{f: req.features[f] for f in FEATURE_NAMES}])[FEATURE_NAMES]

    proba = pipeline.predict_proba(row)[0]
    prob_map = {cls: float(p) for cls, p in zip(TARGET_CLASSES, proba)}
    predicted_label = TARGET_CLASSES[int(proba.argmax())]

    return {
        "label": predicted_label,
        "prob_safe": prob_map.get("Safe", 0.0),
        "prob_at_risk": prob_map.get("At-Risk", 0.0),
        "prob_dropout": prob_map.get("Dropout-Likely", 0.0),
        "model_version": f"{package.get('model_name', 'rf')}_v{package.get('model_version', '1.0')}",
    }
