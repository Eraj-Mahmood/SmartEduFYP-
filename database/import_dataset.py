"""
Loads SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv into Postgres.

For every unique Student_ID in the CSV, this:
  1. creates a `users` row (role='student', a placeholder email/password)
  2. creates a `students` row (department mapped from CSV)
  3. inserts one `student_semester_performance` row per (student, semester)

Run:
    pip install pandas psycopg2-binary --break-system-packages
    python3 import_dataset.py --csv /path/to/dataset.csv --dsn "postgresql://user:pass@localhost:5432/smartedu"
"""
import argparse
import pandas as pd
import psycopg2
import psycopg2.extras as extras
import bcrypt


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--dsn", required=True, help="postgresql://user:pass@host:port/dbname")
    parser.add_argument("--default-password", default="Student@123",
                         help="placeholder password hashed once and reused for every seeded student")
    args = parser.parse_args()

    df = pd.read_csv(args.csv)

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    # map department code -> department_id
    cur.execute("SELECT department_id, code FROM departments")
    dept_map = {code: did for did, code in cur.fetchall()}

    placeholder_hash = hash_pw(args.default_password)

    # one student can appear across multiple semesters -> take first-seen row for profile fields
    first_seen = df.sort_values("Semester").drop_duplicates("Student_ID", keep="first")

    student_id_map = {}  # CSV Student_ID -> DB students.student_id

    print(f"Creating {len(first_seen)} student accounts...")
    for _, row in first_seen.iterrows():
        csv_sid = int(row["Student_ID"])
        email = f"student{csv_sid}@smartedu.edu"
        roll_no = f"BU-{csv_sid}"
        dept_id = dept_map.get(row["Department"])

        cur.execute(
            """INSERT INTO users (email, password_hash, role, must_reset_pw)
               VALUES (%s, %s, 'student', TRUE)
               ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
               RETURNING user_id""",
            (email, placeholder_hash),
        )
        user_id = cur.fetchone()[0]

        cur.execute(
            """INSERT INTO students
               (user_id, roll_no, full_name, department_id, gender, age,
                current_semester, cgpa, scholarship, hostel)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (roll_no) DO UPDATE SET roll_no = EXCLUDED.roll_no
               RETURNING student_id""",
            (
                user_id, roll_no, f"Student {csv_sid}", dept_id, row["Gender"], int(row["Age"]),
                int(row["Semester"]), float(row["CGPA"]), row["Scholarship"], row["Hostel"],
            ),
        )
        student_id_map[csv_sid] = cur.fetchone()[0]

    conn.commit()
    print("Student accounts created. Loading semester performance history...")

    rows = []
    for _, r in df.iterrows():
        db_sid = student_id_map[int(r["Student_ID"])]
        rows.append((
            db_sid, int(r["Semester"]), float(r["Attendance_Percentage"]), float(r["Assignment_Avg"]),
            float(r["Quiz_Avg"]), float(r["Midterm_Marks"]), float(r["Final_Marks"]),
            float(r["Study_Hours_Per_Week"]), int(r["LMS_Login_Count"]), float(r["Assignment_Submission_Rate"]),
            float(r["Previous_SGPA"]), float(r["SGPA"]), float(r["CGPA"]), int(r["Consecutive_Low_CGPA"]),
            int(r["Failed_Courses"]), int(r["Credits_Enrolled"]), int(r["Credits_Passed"]),
            int(r["Warning_Count"]), r["Target_Label"],
        ))

    insert_sql = """
        INSERT INTO student_semester_performance
        (student_id, semester, attendance_percentage, assignment_avg, quiz_avg, midterm_marks,
         final_marks, study_hours_per_week, lms_login_count, assignment_submission_rate,
         previous_sgpa, sgpa, cgpa, consecutive_low_cgpa, failed_courses, credits_enrolled,
         credits_passed, warning_count, target_label)
        VALUES %s
        ON CONFLICT (student_id, semester) DO NOTHING
    """
    extras.execute_values(cur, insert_sql, rows, page_size=1000)
    conn.commit()

    print(f"Done. Inserted {len(rows)} performance rows for {len(student_id_map)} students.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
