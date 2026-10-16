r"""Recover the dataset's labelling policy with a shallow decision tree, then score the
rule set in backend/src/config/policy.json against the labels.

Run from the repo root:
    ml_service\.venv\Scripts\python evaluation\policy_tree.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import cross_val_score
from sklearn.tree import DecisionTreeClassifier, export_text

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv"
POLICY = ROOT / "backend" / "src" / "config" / "policy.json"
FEATURES = ["CGPA", "Previous_SGPA", "Attendance_Percentage", "Failed_Courses", "Warning_Count", "Consecutive_Low_CGPA"]
SEVERITY = {"Safe": 0, "At-Risk": 1, "Dropout-Likely": 2}


def policy_labels(df, t):
    """Same logic as backend/src/services/policy.js."""
    fired = {
        "consecutive_low_cgpa": (df.CGPA < t["probation_cgpa"]) & (df.Previous_SGPA < t["probation_cgpa"]),
        "severe_absence": df.Attendance_Percentage < t["severe_attendance_pct"],
        "low_cgpa": df.CGPA < t["at_risk_cgpa"],
        "low_attendance": df.Attendance_Percentage < t["min_attendance_pct"],
    }
    label = np.full(len(df), "Safe", dtype=object)
    for rule_id, rule_label in [("low_cgpa", "At-Risk"), ("low_attendance", "At-Risk"),
                                ("consecutive_low_cgpa", "Dropout-Likely"), ("severe_absence", "Dropout-Likely")]:
        label[fired[rule_id].to_numpy()] = rule_label
    return pd.Series(label, index=df.index)


def main():
    df = pd.read_csv(CSV)
    y = df.Target_Label

    print("1. Shallow trees on", FEATURES)
    for depth in (1, 2, 3, 4):
        cv = cross_val_score(DecisionTreeClassifier(max_depth=depth, random_state=0), df[FEATURES], y, cv=5).mean()
        print(f"  depth {depth}: 5-fold CV accuracy {cv:.4f}")
    tree = DecisionTreeClassifier(max_depth=3, random_state=0).fit(df[FEATURES], y)
    print(f"\n  depth-3 tree (train accuracy {tree.score(df[FEATURES], y):.4f}):")
    print(export_text(tree, feature_names=FEATURES, show_weights=True))

    print("2. Consecutive_Low_CGPA definition")
    derived = ((df.CGPA < 2.0) & (df.Previous_SGPA < 2.0)).astype(int)
    print(f"  Consecutive_Low_CGPA == (CGPA < 2.0 and Previous_SGPA < 2.0) on {(derived == df.Consecutive_Low_CGPA).mean():.2%} of rows\n")

    print("3. policy.json rule set")
    t = json.loads(POLICY.read_text())["thresholds"]
    print("  thresholds:", t)
    pred = policy_labels(df, t)
    print(f"  accuracy vs Target_Label: {(pred == y).mean():.4f}")
    print(pd.crosstab(y, pred, rownames=["dataset"], colnames=["policy"]).to_string())


if __name__ == "__main__":
    main()
