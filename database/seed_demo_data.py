"""
Populates everything the CSV import CAN'T give you, because your dataset
is semester-level aggregates, not course-level records:

  - Faculty accounts (with logins)
  - Courses (per department)
  - Faculty -> course/section assignments (a faculty member teaching
    multiple subjects AND multiple sections, per your spec)
  - Student enrollments into those classes
  - Per-course results (derived from each student's REAL imported
    performance row, with small realistic jitter per course)
  - Attendance records for the last 8 class sessions

Run this AFTER schema.sql and AFTER import_dataset.py (it needs students
to already exist in the `students` table to enroll them).

Usage:
    pip install psycopg2-binary bcrypt --break-system-packages
    python3 seed_demo_data.py --dsn "postgresql://postgres:PASSWORD@localhost:5432/smartedu"

Safe to re-run: courses/faculty are skipped if they already exist
(unique constraints + ON CONFLICT DO NOTHING). Enrollments/results/
attendance are only created the first time per student-course pair.
"""
import argparse
import random
from datetime import date, timedelta

import bcrypt
import psycopg2
import psycopg2.extras as extras

FACULTY_PASSWORD = "Faculty@123"   # same for every seeded faculty account, for demo convenience
ACADEMIC_YEAR = "2025-2026"
SEMESTER = 5                        # which semester these classes/enrollments belong to

FACULTY_BY_DEPT = {
    "CS":       [("Dr. Amina Sheikh", "Professor"), ("Mr. Bilal Raza", "Assistant Professor")],
    "SE":       [("Dr. Sana Malik", "Associate Professor"), ("Ms. Hira Farooq", "Lecturer")],
    "EE":       [("Dr. Usman Tariq", "Professor"), ("Mr. Omar Siddiqui", "Assistant Professor")],
    "AI":       [("Dr. Ayesha Khan", "Associate Professor"), ("Mr. Zain Abbas", "Lecturer")],
    "Business": [("Dr. Fatima Iqbal", "Professor"), ("Ms. Mahnoor Aziz", "Assistant Professor")],
}

COURSES_BY_DEPT = {
    "CS":       [("CS301", "Data Structures & Algorithms"), ("CS302", "Database Systems"),
                 ("CS401", "Operating Systems"), ("CS402", "Computer Networks")],
    "SE":       [("SE301", "Software Requirements Engineering"), ("SE302", "Software Design & Architecture"),
                 ("SE401", "Software Quality Assurance"), ("SE402", "Software Project Management")],
    "EE":       [("EE301", "Digital Signal Processing"), ("EE302", "Control Systems"),
                 ("EE401", "Power Electronics"), ("EE402", "Microprocessors")],
    "AI":       [("AI301", "Machine Learning"), ("AI302", "Neural Networks"),
                 ("AI401", "Natural Language Processing"), ("AI402", "Computer Vision")],
    "Business": [("BUS301", "Principles of Marketing"), ("BUS302", "Financial Accounting"),
                 ("BUS401", "Organizational Behavior"), ("BUS402", "Strategic Management")],
}

STUDENTS_PER_DEPT = 8   # how many students per department get enrolled/have visible class data
ATTENDANCE_SESSIONS = 8  # how many past class dates to generate attendance for


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute("SELECT department_id, code FROM departments")
    dept_id_by_code = {code: did for did, code in cur.fetchall()}

    faculty_password_hash = hash_pw(FACULTY_PASSWORD)
    faculty_id_by_name = {}

    # ---------------- 1. Faculty ----------------
    print("Creating faculty accounts...")
    emp_counter = 1001
    for dept_code, people in FACULTY_BY_DEPT.items():
        dept_id = dept_id_by_code[dept_code]
        for full_name, designation in people:
            email = full_name.lower().replace("dr. ", "").replace("mr. ", "").replace("ms. ", "").replace(" ", ".") + "@smartedu.edu"
            emp_no = f"F-{emp_counter}"
            emp_counter += 1

            cur.execute(
                """INSERT INTO users (email, password_hash, role, must_reset_pw)
                   VALUES (%s, %s, 'faculty', FALSE)
                   ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                   RETURNING user_id""",
                (email, faculty_password_hash),
            )
            user_id = cur.fetchone()[0]

            cur.execute(
                """INSERT INTO faculty (user_id, employee_no, full_name, department_id, designation)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (employee_no) DO UPDATE SET employee_no = EXCLUDED.employee_no
                   RETURNING faculty_id""",
                (user_id, emp_no, full_name, dept_id, designation),
            )
            faculty_id = cur.fetchone()[0]
            faculty_id_by_name[full_name] = (faculty_id, dept_code)
            print(f"  {full_name} ({dept_code}) -> {email} / {FACULTY_PASSWORD}")

    conn.commit()

    # ---------------- 2. Courses ----------------
    print("\nCreating courses...")
    course_id_by_code = {}
    for dept_code, courses in COURSES_BY_DEPT.items():
        dept_id = dept_id_by_code[dept_code]
        for code, title in courses:
            cur.execute(
                """INSERT INTO courses (course_code, title, department_id, credit_hours)
                   VALUES (%s,%s,%s,3)
                   ON CONFLICT (course_code) DO UPDATE SET course_code = EXCLUDED.course_code
                   RETURNING course_id""",
                (code, title, dept_id),
            )
            course_id_by_code[code] = cur.fetchone()[0]
    conn.commit()
    print(f"  {len(course_id_by_code)} courses ready.")

    # ---------------- 3. Faculty -> Course assignments ----------------
    # Each department's 2 faculty split its 4 courses (2 each), and the first
    # faculty in each department ALSO teaches a second section of course #1 -
    # demonstrates "faculty can teach multiple subjects and multiple classes."
    print("\nAssigning faculty to courses/sections...")
    faculty_course_id_by_key = {}  # (course_code, section) -> faculty_course_id
    for dept_code, people in FACULTY_BY_DEPT.items():
        courses = COURSES_BY_DEPT[dept_code]
        fac_a_id, _ = faculty_id_by_name[people[0][0]]
        fac_b_id, _ = faculty_id_by_name[people[1][0]]

        assignments = [
            (fac_a_id, courses[0][0], "A"),
            (fac_a_id, courses[1][0], "A"),
            (fac_a_id, courses[0][0], "B"),   # same faculty, 2nd section -> multiple classes
            (fac_b_id, courses[2][0], "A"),
            (fac_b_id, courses[3][0], "A"),
        ]
        for fac_id, course_code, section in assignments:
            course_id = course_id_by_code[course_code]
            cur.execute(
                """INSERT INTO faculty_courses (faculty_id, course_id, section, semester, academic_year)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (faculty_id, course_id, section, semester, academic_year) DO UPDATE
                     SET section = EXCLUDED.section
                   RETURNING faculty_course_id""",
                (fac_id, course_id, section, SEMESTER, ACADEMIC_YEAR),
            )
            faculty_course_id_by_key[(course_code, section)] = cur.fetchone()[0]
    conn.commit()
    print(f"  {len(faculty_course_id_by_key)} class sections created.")

    # ---------------- 4. Pick students per department ----------------
    print(f"\nSelecting {STUDENTS_PER_DEPT} students per department to enroll...")
    students_by_dept = {}
    for dept_code, dept_id in dept_id_by_code.items():
        cur.execute(
            """SELECT student_id FROM students WHERE department_id = %s
               ORDER BY random() LIMIT %s""",
            (dept_id, STUDENTS_PER_DEPT),
        )
        students_by_dept[dept_code] = [r[0] for r in cur.fetchall()]
        print(f"  {dept_code}: {len(students_by_dept[dept_code])} students selected")

    # ---------------- 5. Enroll + generate results + attendance ----------------
    print("\nEnrolling students and generating results/attendance...")
    today = date.today()
    class_dates = [today - timedelta(days=7 * i) for i in range(ATTENDANCE_SESSIONS)]

    for dept_code, student_ids in students_by_dept.items():
        # every student in this dept is enrolled in every section for their dept
        relevant_sections = [(c, s) for c, s in faculty_course_id_by_key
                              if any(c == cc for cc, _ in COURSES_BY_DEPT[dept_code]) and s == "A"]

        for student_id in student_ids:
            # pull this student's real imported performance to derive believable per-course marks
            cur.execute(
                """SELECT assignment_avg, quiz_avg, midterm_marks, final_marks, attendance_percentage
                   FROM student_semester_performance WHERE student_id = %s
                   ORDER BY semester DESC LIMIT 1""",
                (student_id,),
            )
            perf = cur.fetchone()
            if not perf:
                continue
            base_assign, base_quiz, base_mid, base_final, base_att = [float(x) for x in perf]

            for course_code, section in relevant_sections:
                fc_id = faculty_course_id_by_key[(course_code, section)]

                cur.execute(
                    """INSERT INTO enrollments (student_id, faculty_course_id, status)
                       VALUES (%s,%s,'enrolled')
                       ON CONFLICT (student_id, faculty_course_id) DO UPDATE SET status = EXCLUDED.status
                       RETURNING enrollment_id""",
                    (student_id, fc_id),
                )
                enrollment_id = cur.fetchone()[0]

                # small per-course jitter so not every course looks identical
                jitter = lambda v: max(0, min(100, v + random.uniform(-6, 6)))
                a, q, m, f = jitter(base_assign), jitter(base_quiz), jitter(base_mid), jitter(base_final)
                overall = (a + q + m + f) / 4
                grade = "A" if overall >= 85 else "B" if overall >= 70 else "C" if overall >= 55 else "D" if overall >= 40 else "F"

                cur.execute(
                    """INSERT INTO course_results (enrollment_id, assignment_avg, quiz_avg, midterm_marks, final_marks, grade, updated_at)
                       VALUES (%s,%s,%s,%s,%s,%s,NOW())
                       ON CONFLICT (enrollment_id) DO UPDATE SET
                         assignment_avg = EXCLUDED.assignment_avg, quiz_avg = EXCLUDED.quiz_avg,
                         midterm_marks = EXCLUDED.midterm_marks, final_marks = EXCLUDED.final_marks,
                         grade = EXCLUDED.grade, updated_at = NOW()""",
                    (enrollment_id, round(a, 2), round(q, 2), round(m, 2), round(f, 2), grade),
                )

                attendance_prob = base_att / 100
                att_rows = []
                for d in class_dates:
                    status = "present" if random.random() < attendance_prob else random.choice(["absent", "leave"])
                    att_rows.append((enrollment_id, d, status))

                extras.execute_values(
                    cur,
                    """INSERT INTO attendance (enrollment_id, class_date, status)
                       VALUES %s ON CONFLICT (enrollment_id, class_date) DO NOTHING""",
                    att_rows,
                )
        conn.commit()
        print(f"  {dept_code} done.")

    cur.close()
    conn.close()

    print("\n" + "=" * 60)
    print("DEMO DATA READY")
    print("=" * 60)
    print(f"Faculty login (all of them): password = {FACULTY_PASSWORD}")
    print("  e.g. amina.sheikh@smartedu.edu")
    print("Students: use any roll number's email from the `students` table,")
    print("  password = Student@123 (or whatever you passed to import_dataset.py)")
    print("Admin: whatever you set with createAdmin.js")


if __name__ == "__main__":
    main()
