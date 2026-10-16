r"""How SGPA, CGPA, Previous_SGPA and the credit columns relate in the synthetic dataset.

The feature builder (backend/src/services/featureBuilder.js) uses the results to turn
current-semester course marks into a provisional SGPA and a projected CGPA.

Run from the repo root:
    ml_service\.venv\Scripts\python evaluation\sgpa_cgpa_relationship.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score

CSV = Path(__file__).resolve().parent.parent / "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv"
MARKS = ["Assignment_Avg", "Quiz_Avg", "Midterm_Marks", "Final_Marks"]


def report(name, actual, predicted):
    predicted = np.clip(predicted, 0, 4)
    err = predicted - actual
    print(f"  {name:48s} R2 {r2_score(actual, predicted):.4f}  MAE {mean_absolute_error(actual, predicted):.3f}"
          f"  bias {err.mean():+.3f}  |err|<=0.10: {(np.abs(err) <= 0.10).mean():.1%}")


def main():
    df = pd.read_csv(CSV)
    print(f"{len(df)} rows\n")

    print("1. Credits")
    exact = (df.Credits_Enrolled - df.Credits_Passed == 3 * df.Failed_Courses).mean()
    print(f"  Credits_Passed == Credits_Enrolled - 3 * Failed_Courses on {exact:.1%} of rows")
    print(f"  Credits_Enrolled values: {sorted(df.Credits_Enrolled.unique())}\n")

    print("2. CGPA from Previous_SGPA and SGPA")
    ols = LinearRegression().fit(df[["Previous_SGPA", "SGPA"]], df.CGPA)
    print(f"  OLS weights Previous_SGPA {ols.coef_[0]:.3f}, SGPA {ols.coef_[1]:.3f}, intercept {ols.intercept_:.3f}")
    for s in sorted(df.Semester.unique()):
        d = df[df.Semester == s]
        m = LinearRegression().fit(d[["Previous_SGPA", "SGPA"]], d.CGPA)
        print(f"    semester {s}: weights {m.coef_[0]:.3f} / {m.coef_[1]:.3f}, intercept {m.intercept_:.3f}")
    report("CGPA = (Previous_SGPA + SGPA) / 2", df.CGPA, (df.Previous_SGPA + df.SGPA) / 2)
    report("CGPA = ((S-1)*Previous_SGPA + SGPA) / S", df.CGPA,
           ((df.Semester - 1) * df.Previous_SGPA + df.SGPA) / df.Semester)
    print()

    print("3. SGPA from marks")
    mean_mark = df[MARKS].mean(axis=1)
    letter_points = np.select([mean_mark >= 85, mean_mark >= 70, mean_mark >= 55, mean_mark >= 40], [4, 3, 2, 1], 0)
    report("letter grade points 4/3/2/1/0 (seed thresholds)", df.SGPA, letter_points)
    lin = LinearRegression().fit(mean_mark.to_frame(), df.SGPA)
    slope, intercept = lin.coef_[0], lin.intercept_
    report(f"SGPA = {slope:.4f} * mean_mark {intercept:+.3f}", df.SGPA, slope * mean_mark + intercept)
    print(f"\n  -> featureBuilder: per-course points = clamp({slope:.4f} * course mean mark {intercept:+.3f}, 0, 4),")
    print("     credit-weighted over current-semester courses; projected CGPA = (Previous_SGPA + SGPA) / 2")


if __name__ == "__main__":
    main()
