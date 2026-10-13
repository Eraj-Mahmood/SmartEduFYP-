# Demo accounts

Accounts for demoing SmartEdu. For each student, the course grades, the CGPA, the
dataset label and the live model prediction all agree. Checked on 2026-10-13 by logging
in as each student, refreshing the prediction (real model, not the rule fallback) and
comparing grades with CGPA.

Passwords are the defaults from the setup scripts: `createAdmin.js` (as run in the README),
`seed_demo_data.py` (`Faculty@123`) and `import_dataset.py` (`Student@123`).

> These students were enrolled by `seed_demo_data.py`, which picks 8 random students per
> department. If the database is rebuilt and re-seeded, the enrolled students change.
> Re-run `database/find_consistent_demo_students.sql` to pick new ones.

## Staff

| Role | Name | Email | Password | Why |
|---|---|---|---|---|
| Admin | — | `admin@smartedu.edu` | `Admin@123` | Sees all students, predictions and interventions. |
| Faculty | Dr. Ayesha Khan (AI) | `ayesha.khan@smartedu.edu` | `Faculty@123` | Teaches AI301 and AI302 section A. Four of the six demo students are in her classes, covering all three labels. |

## Students (password `Student@123` for all)

"Grades" are in course-code order. For AI students that is AI301, AI302, AI401 and AI402.
AI301 and AI302 are Dr. Khan's courses.

| Label | Roll no | Email | Dept | CGPA | Grades | Why it's a good demo case |
|---|---|---|---|---|---|---|
| Safe | BU-100040 | `student100040@smartedu.edu` | AI | 2.91 | B, B, B, A | Mid-range CGPA but 100% attendance, 100% submission and no failed courses. Shows Safe isn't just "high CGPA". |
| Safe | BU-106864 | `student106864@smartedu.edu` | Business | 3.90 | A, A, A, A | Clear top performer on a scholarship. Straight A's, 89% attendance, all credits passed. |
| At-Risk | BU-122785 | `student122785@smartedu.edu` | AI | 1.97 | C, C, C, C | Borderline CGPA with 2 failed courses and 2 warnings (12 of 18 credits passed). Exactly the student an advisor should catch early. |
| At-Risk | BU-112907 | `student112907@smartedu.edu` | AI | 2.24 | C, B, B, C | No failed courses, but CGPA is falling (2.47 → 2.24) and study time is low (9.7 h/week). An early-warning case. |
| Dropout-Likely | BU-144766 | `student144766@smartedu.edu` | AI | 1.62 | C, C, C, C | 3 warnings, consecutive low CGPA, 63% attendance and 55% submission. Same C grades as BU-122785 but a worse label: shows the model weighs behaviour, not only grades. |
| Dropout-Likely | BU-101986 | `student101986@smartedu.edu` | Business | 1.02 | D, D, D, D | Severe case: 3 failed courses, only 9 of 18 credits passed, 63% attendance. |

The student names in the app are placeholders ("Student 100040") unless
`database/generate_student_names.py` has been run.
