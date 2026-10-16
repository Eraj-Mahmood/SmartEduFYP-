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

| Label | Name | Roll no | Email | Dept | CGPA | Grades | Why it's a good demo case |
|---|---|---|---|---|---|---|---|
| Safe | Rabia Gill | BU-100040 | `student100040@smartedu.edu` | AI | 2.91 | B, B, B, A | Mid-range CGPA but 100% attendance, 100% submission and no failed courses. Shows Safe isn't just "high CGPA". |
| Safe | Tahira Aziz | BU-106864 | `student106864@smartedu.edu` | Business | 3.90 | A, A, A, A | Clear top performer on a scholarship. Straight A's, 89% attendance, all credits passed. |
| At-Risk | Sana Tariq | BU-122785 | `student122785@smartedu.edu` | AI | 1.97 | C, C, C, C | Borderline CGPA with 2 failed courses and 2 warnings (12 of 18 credits passed). Exactly the student an advisor should catch early. |
| At-Risk | Hassan Aziz | BU-112907 | `student112907@smartedu.edu` | AI | 2.24 | C, B, B, C | No failed courses, but CGPA is falling (2.47 → 2.24) and study time is low (9.7 h/week). An early-warning case. |
| Dropout-Likely | Nida Shah | BU-144766 | `student144766@smartedu.edu` | AI | 1.62 | C, C, C, C | 3 warnings, consecutive low CGPA, 63% attendance and 55% submission. Same C grades as BU-122785 but a worse label: shows the model weighs behaviour, not only grades. |
| Dropout-Likely | Omar Ahmed | BU-101986 | `student101986@smartedu.edu` | Business | 1.02 | D, D, D, D | Severe case: 3 failed courses, only 9 of 18 credits passed, 63% attendance. |

Names come from `database/generate_student_names.py` (run on 2026-10-16). It only rewrites
`students.full_name`, never emails, roll numbers or IDs. Re-running it picks new random names, so
update this table if you do.

## Live re-prediction demo

Faculty saves re-predict the student straight away. A realistic change that moves a label
(checked on 2026-10-16 with the Phase 2 screens):

1. Log in as `ayesha.khan@smartedu.edu` → **My classes** → **View class** on **AI301 · Section A**.
2. In the **BU-112907** row change **Quiz 57.87 → 75** and **Midterm 70.13 → 88** (keep Assignment
   67.18 and Final 80.40) and press **Save** (or Enter). Without a page reload:
   - the grade cell changes **C → B** (derived on the server),
   - the risk chip changes **Needs attention → Safe**,
   - a toast reads **"BU-112907: At-Risk → Safe"**.
3. Log in as `student112907@smartedu.edu`: the status is **"You're on track"** (Safe), with projected
   CGPA now above the 2.30 good-standing threshold.

To undo it, type the original marks again (Quiz 57.87, Midterm 70.13) and save; the student goes back to At-Risk.

Admin part of the demo: **Overview → Run predictions → Department → Artificial Intelligence → Start run**.
The progress bar fills in about 15 seconds and the charts refresh when it finishes.
