"""Builds evaluation/sample_live_cohort.csv: a SYNTHETIC stand-in for a real live cohort.

    python evaluation/make_sample_live_cohort.py [--n 30] [--seed 7]

There is no real classroom file yet, so 30 students are drawn from the synthetic dataset in the
live-cohort format (docs/LIVE_DATA_TEMPLATE.md). The model's train/test split was not saved (the .pkl
holds no split indices and the notebook isn't in this repo), so rows NOT used in training can't be
identified: this is a random sample, stratified by label (n/3 each) so every class appears. Most of
these rows were therefore probably seen in training - the evaluation on them is optimistic.

Everything is marked SYNTHETIC: roll numbers start with SYN-, names are "Synthetic Sample NN", and
actual_outcome is the dataset's own (policy-derived) Target_Label, not an observed outcome.
Gender, age, study hours, LMS logins, submission rate, scholarship and hostel are left out on purpose,
as a real file may not have them: the pipeline imputes them.
"""
import argparse
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv"
OUT = Path(__file__).resolve().parent / "sample_live_cohort.csv"
OUTCOME = {"Safe": "safe", "At-Risk": "at_risk", "Dropout-Likely": "dropout"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    df = pd.read_csv(DATASET)
    per = args.n // len(OUTCOME)
    sample = (
        pd.concat([g.sample(n=per, random_state=args.seed) for _, g in df.groupby("Target_Label")])
        .sample(frac=1, random_state=args.seed)  # shuffle so labels are mixed
        .reset_index(drop=True)
    )
    out = pd.DataFrame({
        "roll_no": "SYN-" + sample["Student_ID"].astype(str),
        "full_name": [f"Synthetic Sample {i + 1:02d}" for i in range(len(sample))],
        "department": sample["Department"],
        "semester": sample["Semester"],
        "cgpa": sample["CGPA"],
        "previous_sgpa": sample["Previous_SGPA"],
        "attendance": sample["Attendance_Percentage"],
        "assignment": sample["Assignment_Avg"],
        "quiz": sample["Quiz_Avg"],
        "midterm": sample["Midterm_Marks"],
        "final": sample["Final_Marks"],
        "failed_courses": sample["Failed_Courses"],
        "credits": sample["Credits_Enrolled"],
        "actual_outcome": sample["Target_Label"].map(OUTCOME),
    })
    out.to_csv(OUT, index=False, lineterminator="\r\n")
    print(f"SYNTHETIC sample: {len(out)} rows -> {OUT}")
    print(out["actual_outcome"].value_counts().to_string())


if __name__ == "__main__":
    main()
