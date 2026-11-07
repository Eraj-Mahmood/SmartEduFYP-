"""
Populates everything the CSV import CAN'T give you, because your dataset
is semester-level aggregates, not course-level records:

  - Faculty accounts (with logins)
  - Courses (per department)
  - Faculty -> course/section assignments (a faculty member teaching
    multiple subjects AND multiple sections, per your spec)
  - Student enrollments into those classes
  - Per-course results derived from each student's REAL imported performance
    row, so the course grades agree with the CGPA (see derive_course_means)
  - Attendance records for the last 8 class sessions, matching the imported
    attendance percentage

Run this AFTER schema.sql, the migrations and import_dataset.py (it needs students
to already exist in the `students` table to enroll them). `cd backend; npm run demo:reset`
runs the whole chain.

DETERMINISTIC: every random choice uses random.Random(--seed) (default 2026), the enrolled
students are a fixed list (PINNED_STUDENTS, the ones docs/DEMO_ACCOUNTS.md and the tests use)
and the 8 class dates count back weekly from --as-of (default: today). Same seed + same as-of
date -> identical rows.

Usage:
    python -m pip install -r database/requirements.txt
    python seed_demo_data.py --dsn "postgresql://postgres:PASSWORD@localhost:5432/smartedu" [--seed 2026] [--as-of 2026-11-07]

Safe to re-run: courses/faculty are skipped if they already exist
(unique constraints + ON CONFLICT DO NOTHING). Enrollments/results/
attendance are upserted per student-course pair.
"""
import argparse
import itertools
import random
from datetime import date, timedelta

import bcrypt
import psycopg2
import psycopg2.extras as extras

FACULTY_PASSWORD = "Faculty@123"   # same for every seeded faculty account, for demo convenience
ACADEMIC_YEAR = "2025-2026"
SEMESTER = 5                        # which semester these classes/enrollments belong to
DEFAULT_SEED = 2026

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

# The students enrolled since Phase 1 (originally a random pick). Pinned so the demo accounts,
# tests and docs keep their roll numbers after a rebuild. A roll number missing from the database
# is replaced by a seeded random pick from the same department.
PINNED_STUDENTS = {
    "AI":       ["BU-100040", "BU-112907", "BU-114400", "BU-115624", "BU-122785", "BU-134573", "BU-143820", "BU-144766"],
    "Business": ["BU-100279", "BU-101986", "BU-106864", "BU-108038", "BU-112800", "BU-122855", "BU-143246", "BU-144185"],
    "CS":       ["BU-117492", "BU-125811", "BU-127235", "BU-129601", "BU-138555", "BU-145301", "BU-145871", "BU-148379"],
    "EE":       ["BU-100478", "BU-100752", "BU-102451", "BU-116197", "BU-129079", "BU-132323", "BU-134837", "BU-142285"],
    "SE":       ["BU-100008", "BU-102717", "BU-109652", "BU-114527", "BU-122773", "BU-131710", "BU-138900", "BU-149517"],
}

# ---- marks that agree with the CGPA ---------------------------------------------------------
# Keep in sync with backend/src/services/grading.js (grade) and featureBuilder.js (provisional
# SGPA = credit-weighted clamp(0.0640 * course mean - 2.453, 0, 4); projected CGPA =
# (Previous_SGPA + SGPA) / 2).
SGPA_SLOPE, SGPA_INTERCEPT = 0.064, -2.453
GRADE_BANDS = [("A", 4, 85, 100), ("B", 3, 70, 85), ("C", 2, 55, 70), ("D", 1, 40, 55), ("F", 0, 0, 40)]
EDGE = 0.05          # keep course means this far inside a grade band (rounding never crosses it)
MAX_SPREAD = 12      # a course mean stays within this many marks of the student's target mean
ZERO_POINT_MARK = -SGPA_INTERCEPT / SGPA_SLOPE   # 38.33: below this a course adds 0 SGPA points


def grade_for(overall):
    for letter, _pts, lo, _hi in GRADE_BANDS:
        if overall >= lo:
            return letter
    return "F"


def target_mean(cgpa, previous_sgpa):
    """The course mean whose provisional SGPA makes the projected CGPA equal the imported CGPA."""
    sgpa = min(4.0, max(0.0, 2 * cgpa - previous_sgpa))
    return min(100.0, max(0.0, (sgpa - SGPA_INTERCEPT) / SGPA_SLOPE))


def derive_course_means(m, cgpa, n, rng):
    """n course means averaging exactly m whose letter-grade points (A4..F0) average as close to the
    CGPA as possible. Each mean stays within MAX_SPREAD of m, and above 38.33 when m is (so the
    per-course SGPA clamp never bends the average)."""
    floor = ZERO_POINT_MARK + EDGE if m >= ZERO_POINT_MARK + EDGE else 0.0
    best = None
    for combo in itertools.combinations_with_replacement(range(len(GRADE_BANDS)), n):
        bounds = []
        for g in combo:
            _l, _p, lo, hi = GRADE_BANDS[g]
            lo = max(lo + (EDGE if lo > 0 else 0), m - MAX_SPREAD, floor)
            hi = min(hi - (EDGE if hi < 100 else 0), m + MAX_SPREAD, 100)
            bounds.append((lo, hi))
        if any(lo > hi for lo, hi in bounds):
            continue
        if not (sum(lo for lo, _ in bounds) <= n * m <= sum(hi for _, hi in bounds)):
            continue
        pts = sum(GRADE_BANDS[g][1] for g in combo) / n
        spread = sum(abs((lo + hi) / 2 - m) for lo, hi in bounds)
        key = (round(abs(pts - cgpa), 6), spread)
        if best is None or key < best[0]:
            best = (key, bounds)
    bounds = best[1]
    # start each course as close to m as its band allows, then spread the remainder
    vals = [min(hi, max(lo, m)) for lo, hi in bounds]
    for _ in range(20):
        diff = n * m - sum(vals)
        if abs(diff) < 1e-9:
            break
        movable = [i for i, (lo, hi) in enumerate(bounds) if (vals[i] < hi if diff > 0 else vals[i] > lo)]
        for i in movable:
            vals[i] = min(bounds[i][1], max(bounds[i][0], vals[i] + diff / len(movable)))
    # zero-sum jitter, scaled down so every course stays inside its band
    jit = [rng.uniform(-4, 4) for _ in range(n)]
    avg = sum(jit) / n
    jit = [j - avg for j in jit]
    t = 1.0
    for v, j, (lo, hi) in zip(vals, jit, bounds):
        if j > 0 and v + j > hi:
            t = min(t, (hi - v) / j)
        if j < 0 and v + j < lo:
            t = min(t, (lo - v) / j)
    vals = [v + t * j for v, j in zip(vals, jit)]
    order = list(range(n))
    rng.shuffle(order)   # which course gets which mean
    return [vals[i] for i in order]


def fit_mean(values, target):
    """Shift values (each kept in 0-100) so they average exactly target."""
    vals = list(values)
    for _ in range(20):
        diff = len(vals) * target - sum(vals)
        if abs(diff) < 1e-9:
            break
        movable = [i for i, v in enumerate(vals) if (v < 100 if diff > 0 else v > 0)]
        for i in movable:
            vals[i] = min(100.0, max(0.0, vals[i] + diff / len(movable)))
    return vals


def course_components(course_mean, base, rng):
    """assignment, quiz, midterm, final for one course: the student's own profile (each component's
    distance from their imported mean) moved to course_mean, with a little zero-sum jitter. Rounded to
    2 dp; the grade from these rounded marks is the band course_mean was placed in."""
    base_mean = sum(base) / 4
    jit = [rng.uniform(-3, 3) for _ in range(4)]
    avg = sum(jit) / 4
    raw = [course_mean + (b - base_mean) + (j - avg) for b, j in zip(base, jit)]
    vals = fit_mean([min(100.0, max(0.0, v)) for v in raw], course_mean)
    return [round(v, 2) for v in vals]


def attendance_rows(enrollment_ids, class_dates, pct, rng):
    """present count = the imported percentage of all sessions, rounded but kept on the same side of
    the 60% / 75% policy thresholds; which sessions are missed (absent or leave) is seeded."""
    slots = [(e, d) for e in enrollment_ids for d in class_dates]
    total = len(slots)
    present = round(pct / 100 * total)
    for threshold in (60, 75):
        if pct < threshold and 100 * present / total >= threshold:
            present -= 1
        if pct >= threshold and 100 * present / total < threshold:
            present += 1
    present = min(total, max(0, present))
    present_slots = set(rng.sample(range(total), present))
    return [(e, d, "present" if i in present_slots else rng.choice(["absent", "leave"]))
            for i, (e, d) in enumerate(slots)]


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(),
                        help="date of the latest class session (YYYY-MM-DD, default today)")
    args = parser.parse_args()
    rng = random.Random(args.seed)

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute("SELECT department_id, code FROM departments ORDER BY department_id")
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
        pinned = PINNED_STUDENTS.get(dept_code, [])
        cur.execute(
            "SELECT roll_no, student_id FROM students WHERE department_id = %s AND roll_no = ANY(%s)",
            (dept_id, pinned),
        )
        found = dict(cur.fetchall())
        chosen = [found[r] for r in pinned if r in found]
        if len(chosen) < STUDENTS_PER_DEPT:
            cur.execute(
                "SELECT student_id FROM students WHERE department_id = %s AND data_source = 'synthetic' ORDER BY student_id",
                (dept_id,),
            )
            pool = [r[0] for r in cur.fetchall() if r[0] not in chosen]
            chosen += rng.sample(pool, min(len(pool), STUDENTS_PER_DEPT - len(chosen)))
        students_by_dept[dept_code] = chosen
        print(f"  {dept_code}: {len(chosen)} students ({len([r for r in pinned if r in found])} pinned)")

    # ---------------- 5. Enroll + generate results + attendance ----------------
    print("\nEnrolling students and generating results/attendance...")
    class_dates = [args.as_of - timedelta(days=7 * i) for i in range(ATTENDANCE_SESSIONS)]

    for dept_code, student_ids in students_by_dept.items():
        # every student in this dept is enrolled in every section-A class of their dept
        dept_courses = [c for c, _ in COURSES_BY_DEPT[dept_code]]
        relevant_sections = [(c, "A") for c in dept_courses if (c, "A") in faculty_course_id_by_key]

        for student_id in student_ids:
            # this student's real imported performance -> per-course marks that agree with the CGPA
            cur.execute(
                """SELECT assignment_avg, quiz_avg, midterm_marks, final_marks, attendance_percentage,
                          cgpa, previous_sgpa
                   FROM student_semester_performance WHERE student_id = %s
                   ORDER BY semester DESC LIMIT 1""",
                (student_id,),
            )
            perf = cur.fetchone()
            if not perf:
                continue
            base_assign, base_quiz, base_mid, base_final, base_att, cgpa, prev_sgpa = [float(x) for x in perf]
            base = [base_assign, base_quiz, base_mid, base_final]
            means = derive_course_means(target_mean(cgpa, prev_sgpa), cgpa, len(relevant_sections), rng)

            enrollment_ids = []
            for (course_code, section), course_mean in zip(relevant_sections, means):
                fc_id = faculty_course_id_by_key[(course_code, section)]

                cur.execute(
                    """INSERT INTO enrollments (student_id, faculty_course_id, status)
                       VALUES (%s,%s,'enrolled')
                       ON CONFLICT (student_id, faculty_course_id) DO UPDATE SET status = EXCLUDED.status
                       RETURNING enrollment_id""",
                    (student_id, fc_id),
                )
                enrollment_id = cur.fetchone()[0]
                enrollment_ids.append(enrollment_id)

                a, q, m, f = course_components(course_mean, base, rng)
                grade = grade_for((a + q + m + f) / 4)

                cur.execute(
                    """INSERT INTO course_results (enrollment_id, assignment_avg, quiz_avg, midterm_marks, final_marks, grade, updated_at)
                       VALUES (%s,%s,%s,%s,%s,%s,NOW())
                       ON CONFLICT (enrollment_id) DO UPDATE SET
                         assignment_avg = EXCLUDED.assignment_avg, quiz_avg = EXCLUDED.quiz_avg,
                         midterm_marks = EXCLUDED.midterm_marks, final_marks = EXCLUDED.final_marks,
                         grade = EXCLUDED.grade, updated_at = NOW()""",
                    (enrollment_id, a, q, m, f, grade),
                )

            extras.execute_values(
                cur,
                """INSERT INTO attendance (enrollment_id, class_date, status)
                   VALUES %s ON CONFLICT (enrollment_id, class_date) DO NOTHING""",
                attendance_rows(enrollment_ids, class_dates, base_att, rng),
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
