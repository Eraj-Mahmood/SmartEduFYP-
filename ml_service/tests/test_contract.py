"""ML service contract tests (Phase 6). Run from ml_service/: .venv\\Scripts\\python -m pytest tests

The backend relies on this exact interface (services/predictionService.js). test_predict.py covers
the basics (feature order, probabilities sum to 1, missing feature 400, explanation shape, a 3-row
batch, the model responding to CGPA/attendance); this file pins the rest of the contract.
"""
import math
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as ml_app  # noqa: E402
from test_predict import EXPECTED_FEATURES, SAFE_ROW, AT_RISK_ROW, DROPOUT_ROW  # noqa: E402

client = TestClient(ml_app.app)
CLASSES = ["At-Risk", "Dropout-Likely", "Safe"]
RESULT_KEYS = {"label", "prob_safe", "prob_at_risk", "prob_dropout", "model_version", "explanations", "base_value"}
DATASET = Path(__file__).resolve().parents[2] / "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv"


def dataset_sample(n, seed):
    df = pd.read_csv(DATASET).sample(n=n, random_state=seed)
    rows = df[EXPECTED_FEATURES].to_dict(orient="records")
    return rows, df["Target_Label"].tolist()


def predict(row):
    res = client.post("/predict", json={"features": row})
    assert res.status_code == 200, res.text
    return res.json()


# ---- output shape ------------------------------------------------------------------------------

@pytest.mark.parametrize("row", [SAFE_ROW, AT_RISK_ROW, DROPOUT_ROW])
def test_output_shape_and_types(row):
    body = predict(row)
    assert set(body) == RESULT_KEYS
    assert body["label"] in CLASSES
    for k in ("prob_safe", "prob_at_risk", "prob_dropout"):
        assert isinstance(body[k], float) and 0.0 <= body[k] <= 1.0
    assert isinstance(body["model_version"], str) and body["model_version"]
    assert isinstance(body["base_value"], float)
    assert isinstance(body["explanations"], list) and len(body["explanations"]) == 5
    for e in body["explanations"]:
        assert set(e) == {"feature", "value", "shap", "direction"}
        assert e["feature"] in EXPECTED_FEATURES
        assert isinstance(e["shap"], float)


@pytest.mark.parametrize("row", [SAFE_ROW, AT_RISK_ROW, DROPOUT_ROW])
def test_label_is_the_most_probable_class(row):
    body = predict(row)
    probs = {"Safe": body["prob_safe"], "At-Risk": body["prob_at_risk"], "Dropout-Likely": body["prob_dropout"]}
    assert body["label"] == max(probs, key=probs.get)


def test_the_three_reference_rows_get_their_labels():
    assert predict(SAFE_ROW)["label"] == "Safe"
    assert predict(AT_RISK_ROW)["label"] == "At-Risk"
    assert predict(DROPOUT_ROW)["label"] == "Dropout-Likely"


def test_explanation_directions_match_the_sign_for_a_risky_label():
    body = predict(DROPOUT_ROW)
    for e in body["explanations"]:
        assert e["direction"] == ("raises_risk" if e["shap"] > 0 else "lowers_risk")


# ---- inputs ------------------------------------------------------------------------------------

@pytest.mark.parametrize("missing", ["CGPA", "Department", "Hostel"])
def test_each_missing_feature_gives_400_naming_it(missing):
    row = {k: v for k, v in SAFE_ROW.items() if k != missing}
    res = client.post("/predict", json={"features": row})
    assert res.status_code == 400
    assert missing in res.json()["detail"]


def test_missing_feature_in_a_batch_gives_400():
    bad = {k: v for k, v in AT_RISK_ROW.items() if k != "SGPA"}
    res = client.post("/predict/batch", json={"rows": [SAFE_ROW, bad]})
    assert res.status_code == 400
    assert "SGPA" in res.json()["detail"]


def test_null_values_are_imputed_not_rejected():
    """Live-cohort rows send null for unknown inputs; the pipeline's imputers fill them."""
    row = {**AT_RISK_ROW, "Study_Hours_Per_Week": None, "LMS_Login_Count": None, "Gender": None, "Hostel": None}
    body = predict(row)
    assert body["label"] in CLASSES
    assert body["prob_safe"] + body["prob_at_risk"] + body["prob_dropout"] == pytest.approx(1.0, abs=1e-6)
    for e in body["explanations"]:
        if e["feature"] in ("Study_Hours_Per_Week", "LMS_Login_Count", "Gender", "Hostel"):
            assert e["value"] is None  # NaN goes back as null, never as a NaN token


def test_batch_limits():
    assert client.post("/predict/batch", json={"rows": []}).status_code == 400
    too_many = client.post("/predict/batch", json={"rows": [SAFE_ROW] * (ml_app.MAX_BATCH + 1)})
    assert too_many.status_code == 400


# ---- consistency -------------------------------------------------------------------------------

def test_batch_equals_single_calls_on_50_dataset_rows():
    rows, _ = dataset_sample(50, seed=11)
    batch = client.post("/predict/batch", json={"rows": rows}).json()["results"]
    assert len(batch) == 50
    for row, out in zip(rows, batch):
        single = predict(row)
        assert out["label"] == single["label"]
        for k in ("prob_safe", "prob_at_risk", "prob_dropout"):
            assert out[k] == pytest.approx(single[k], abs=1e-9)


def test_deterministic():
    a, b = predict(AT_RISK_ROW), predict(AT_RISK_ROW)
    assert a == b


def test_model_responds_to_its_inputs():
    """Worse academic inputs move probability towards Dropout-Likely; better ones towards Safe."""
    base = predict(AT_RISK_ROW)
    worse = predict({**AT_RISK_ROW, "CGPA": 1.2, "Previous_SGPA": 1.1, "SGPA": 1.0, "Attendance_Percentage": 55})
    better = predict({**AT_RISK_ROW, "CGPA": 3.4, "Previous_SGPA": 3.3, "SGPA": 3.5, "Attendance_Percentage": 95})
    assert worse["prob_dropout"] > base["prob_dropout"]
    assert better["prob_safe"] > base["prob_safe"]
    assert worse["label"] == "Dropout-Likely" and better["label"] == "Safe"


def test_agrees_with_the_dataset_labels_on_a_fixed_sample():
    """500 rows (random_state 7) of the dataset the model was trained and tested on. The official
    held-out numbers are the .pkl metrics (test accuracy 0.9996); this is a smoke check that the
    loaded model + this service reproduce them, not a fresh evaluation."""
    rows, truth = dataset_sample(500, seed=7)
    results = client.post("/predict/batch", json={"rows": rows}).json()["results"]
    accuracy = sum(r["label"] == t for r, t in zip(results, truth)) / len(truth)
    assert accuracy >= 0.99


# ---- model card ----------------------------------------------------------------------------------

def test_health_and_model_info():
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["features_expected"] == EXPECTED_FEATURES
    info = client.get("/model-info").json()
    assert info["feature_names"] == EXPECTED_FEATURES
    assert sorted(info["class_labels"] if "class_labels" in info else info["target_classes"]) == CLASSES
    text = str(info)
    assert "1.9.0" in text  # scikit-learn version the model was pickled with
    sha = info.get("model_sha256") or info.get("sha256")
    assert sha and len(sha) == 64
