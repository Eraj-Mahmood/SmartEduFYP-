"""Run from ml_service/: .venv\Scripts\python -m pytest tests"""
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
