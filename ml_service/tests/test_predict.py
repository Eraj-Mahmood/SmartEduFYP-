r"""Run from ml_service/: .venv\Scripts\python -m pytest tests"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as ml_app  # noqa: E402

client = TestClient(ml_app.app)

EXPECTED_FEATURES = [
    "Semester", "Department", "Gender", "Age", "Attendance_Percentage", "Assignment_Avg",
    "Quiz_Avg", "Midterm_Marks", "Final_Marks", "Study_Hours_Per_Week", "LMS_Login_Count",
    "Assignment_Submission_Rate", "Previous_SGPA", "SGPA", "CGPA", "Failed_Courses",
    "Credits_Enrolled", "Credits_Passed", "Scholarship", "Hostel",
]

SAFE_ROW = {
    "Semester": 8, "Department": "AI", "Gender": "Female", "Age": 18,
    "Attendance_Percentage": 100, "Assignment_Avg": 88.3, "Quiz_Avg": 85.5,
    "Midterm_Marks": 81.8, "Final_Marks": 81.9, "Study_Hours_Per_Week": 15.1,
    "LMS_Login_Count": 39, "Assignment_Submission_Rate": 100, "Previous_SGPA": 2.92,
    "SGPA": 3.18, "CGPA": 2.91, "Failed_Courses": 0, "Credits_Enrolled": 15,
    "Credits_Passed": 15, "Scholarship": "No", "Hostel": "Yes",
}
AT_RISK_ROW = {**SAFE_ROW, "Attendance_Percentage": 80.7, "Previous_SGPA": 2.1, "SGPA": 1.89,
               "CGPA": 1.97, "Failed_Courses": 2, "Credits_Enrolled": 18, "Credits_Passed": 12}
DROPOUT_ROW = {**SAFE_ROW, "Attendance_Percentage": 63, "Assignment_Submission_Rate": 55,
               "Previous_SGPA": 1.04, "SGPA": 1.04, "CGPA": 1.02, "Failed_Courses": 3,
               "Credits_Enrolled": 18, "Credits_Passed": 9}


def test_feature_names_in_order():
    assert ml_app.FEATURE_NAMES == EXPECTED_FEATURES
    assert client.get("/health").json()["features_expected"] == EXPECTED_FEATURES


@pytest.mark.parametrize("row", [SAFE_ROW, AT_RISK_ROW, DROPOUT_ROW])
def test_probabilities_sum_to_one(row):
    body = client.post("/predict", json={"features": row}).json()
    total = body["prob_safe"] + body["prob_at_risk"] + body["prob_dropout"]
    assert total == pytest.approx(1.0, abs=1e-6)


def test_missing_feature_gives_400():
    row = {k: v for k, v in SAFE_ROW.items() if k != "CGPA"}
    res = client.post("/predict", json={"features": row})
    assert res.status_code == 400
    assert "CGPA" in res.json()["detail"]


def test_explanations_top5_with_valid_directions():
    body = client.post("/predict", json={"features": DROPOUT_ROW}).json()
    assert len(body["explanations"]) == 5
    shaps = [abs(e["shap"]) for e in body["explanations"]]
    assert shaps == sorted(shaps, reverse=True)
    for e in body["explanations"]:
        assert e["feature"] in EXPECTED_FEATURES
        assert e["direction"] in ("raises_risk", "lowers_risk")
        assert e["value"] == DROPOUT_ROW[e["feature"]]
    assert isinstance(body["base_value"], float)


def test_batch_of_three_gives_three_results():
    rows = [SAFE_ROW, AT_RISK_ROW, DROPOUT_ROW]
    res = client.post("/predict/batch", json={"rows": rows})
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 3
    for row, out in zip(rows, results):
        single = client.post("/predict", json={"features": row}).json()
        assert out == single


def test_changing_cgpa_and_attendance_changes_the_model_output():
    """The label comes from the model's learned function: the same row with a lower CGPA and lower
    attendance gets different probabilities and a riskier label (no hardcoded rule in this service)."""
    base = client.post("/predict", json={"features": SAFE_ROW}).json()
    worse = client.post("/predict", json={"features": {**SAFE_ROW, "CGPA": 1.6, "Attendance_Percentage": 55}}).json()
    assert base["label"] == "Safe"
    assert worse["label"] != "Safe"
    assert worse["prob_safe"] < base["prob_safe"]
    assert (worse["prob_safe"], worse["prob_at_risk"], worse["prob_dropout"]) != (
        base["prob_safe"], base["prob_at_risk"], base["prob_dropout"])
    # each change on its own also moves the probabilities
    for change in ({"CGPA": 1.6}, {"Attendance_Percentage": 55}):
        one = client.post("/predict", json={"features": {**SAFE_ROW, **change}}).json()
        assert one["prob_safe"] != base["prob_safe"]


def test_model_info():
    info = client.get("/model-info").json()
    assert info["model_type"] == "RandomForestClassifier"
    assert info["feature_names"] == EXPECTED_FEATURES
    assert info["n_features"] == 20
    assert info["class_labels"] == ["At-Risk", "Dropout-Likely", "Safe"]
    assert info["metrics"]["test_macro_f1"] > 0.99
    assert info["sklearn_version"] == "1.9.0"
    imp = info["global_importance"]
    assert imp["sample"]["rows"] == 2000
    assert len(imp["features"]) == 20
    assert {f["feature"] for f in imp["features"]} == set(EXPECTED_FEATURES)
    values = [f["mean_abs_shap"] for f in imp["features"]]
    assert values == sorted(values, reverse=True) and values[0] > 0


def test_missing_values_are_imputed():
    """null features (a live cohort without e.g. Gender or study hours) are filled by the pipeline's
    imputers: a null category gets the training set's most frequent value, not an 'unknown' column."""
    nulls = {**AT_RISK_ROW, "Gender": None, "Scholarship": None, "Hostel": None, "Age": None,
             "Study_Hours_Per_Week": None, "LMS_Login_Count": None, "Assignment_Submission_Rate": None}
    res = client.post("/predict", json={"features": nulls})
    assert res.status_code == 200
    body = res.json()
    assert body["label"] in ("Safe", "At-Risk", "Dropout-Likely")
    fill = ml_app.preprocessing.named_transformers_["categorical"].named_steps["imputer"].statistics_
    filled = {**nulls, "Gender": fill[1], "Scholarship": fill[2], "Hostel": fill[3]}
    same = client.post("/predict", json={"features": filled}).json()
    assert body["prob_safe"] == pytest.approx(same["prob_safe"])
    for e in body["explanations"]:
        assert e["value"] is None or e["value"] == nulls[e["feature"]]
