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
| Faculty | Mr. Bilal Raza (CS) | `bilal.raza@smartedu.edu` | `Faculty@123` | Teaches CS401 section A (no demo students): the **upload demo** class. |
| Faculty | Dr. Amina Sheikh (CS) | `amina.sheikh@smartedu.edu` | `Faculty@123` | Teaches the **live cohort** class (CS301 section LIVE, 30 SYNTHETIC students `SYN-*`). |

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

## Chat demo ("Ask SmartEdu")

Log in as **Nida Shah** (`student144766@smartedu.edu`, Dropout-Likely) and open **Ask SmartEdu**
on the dashboard (or press **Ask about this** under "Why", which sends question 1 for you).
These four questions show the assistant best. Every answer comes from the templates (Layer 1):
no LLM or API key is needed, and the ML service can be stopped.

| # | Ask | What it shows |
|---|---|---|
| 1 | `Why is my status this?` | The label in supportive wording, the three reasons, and a reminder that this is a warning, not a final result. |
| 2 | `meri attendance kaisi hai?` | Roman Urdu understood: 65.6% (21 of 32), attendance per course, and "attend the next 12 classes without missing one to reach 75%". |
| 3 | `How can I improve?` | The ranked next steps with real targets: average 85 (A) to reach the 2.30 Safe line, 75 (B) for 2.00, plus the attendance condition. |
| 4 | `What is BU-122785's CGPA?` | Refusal. It never confirms whether that student exists and shows none of their numbers. |

Other good ones: `Tell me about Natural Language Processing` (course by title), `What are my marks in CS301?`
("isn't one of your courses"), `I'm so stressed about my exams` (wellbeing reply with the support contacts
from `backend/src/config/support.json`). To start the demo clean, use **Clear chat** in the panel.

## Interventions demo (demo script step 6)

Shows the Phase 4 workflow: a flagged student ends up with a named counselor, a tutorial for
their weakest course and an intervention message. Checked end to end on 2026-11-07 (Playwright,
1280px and 390px). Use three browser windows (or one private window per account).

1. **Admin** (`admin@smartedu.edu`) → **Interventions** → search `BU-144766` (Nida Shah, Dropout-Likely).
   The row shows the weakest course **AI401 (avg 57)**, its tutorial **Hugging Face LLM Course**,
   Counselor **Assign** and Last intervention **never**.
   - Press **Assign** → the picker lists Artificial Intelligence faculty first with their current
     counselee counts → choose **Dr. Ayesha Khan** → **Assign**. A toast confirms; the row now
     shows "Dr. Ayesha Khan · not contacted yet".
   - Press **Send** → keep the template (it uses `{name}`, `{course}` and `{counselor}`) and
     "Add each student's recommended tutorial". The preview shows Nida's own copy ending with
     `Recommended for AI401: "Hugging Face LLM Course" - https://huggingface.co/learn/llm-course`.
     Press **Send**; Last intervention becomes "just now".
2. **Student** (`student144766@smartedu.edu`): the bell shows **2 unread** (the counselor notice
   and the intervention). **What to do next** shows the counselor card (Dr. Ayesha Khan, Associate
   Professor, a mailto link, "Assigned just now"), the tutorial card with **Open tutorial**, and
   the ranked next steps. Clicking the intervention in the bell scrolls to that card. Asking
   SmartEdu "Who can help me?" now names Dr. Khan and her email.
3. **Faculty** (`ayesha.khan@smartedu.edu`) → **My counselees**: Nida Shah with her label, main
   reason and "Not contacted yet". Opening her shows the next steps, the tutorial and a notes box
   that saves itself ("Saved"); **Mark contacted today** and **Close assignment** are at the bottom.
   The bell has "You've been assigned as counselor to Nida Shah (Dropout-Likely)"; clicking it
   opens her drawer.

Other things to show: select several rows and **Send to N** (each student gets their own name,
course and tutorial); **Export CSV**; **Tutorials** (add, edit, deactivate, open link);
**Audit log** (filter by entity `counselor_assignments`, open a row for the JSON).

**To undo it** (so the demo can be repeated): Admin → **Interventions** → search `BU-144766` →
click **Dr. Ayesha Khan** in the Counselor column → **Close assignment** → **Confirm**. (Dr. Khan
can also press **Close assignment** in her drawer.) The row shows **Assign** again. The
notifications and the audit history stay on purpose. For a completely clean bell before a
presentation, delete the demo notifications in pgAdmin:

```sql
DELETE FROM notifications
WHERE recipient_user_id IN (SELECT user_id FROM students WHERE roll_no = 'BU-144766'
                            UNION SELECT user_id FROM users WHERE email = 'ayesha.khan@smartedu.edu')
  AND sent_at > NOW() - INTERVAL '1 day';
```

`npm run screenshots` never touches these accounts' assignments or bells: it uses BU-115624
(Haris Rehman) with Mr. Zain Abbas as counselor and closes that assignment at the end.

## Phase 5 demos: the model, what-if, uploads, live data

### The model is real (Admin → Model)

Log in as admin → **Model**. Point out: the model card (RandomForestClassifier, 300 trees,
scikit-learn 1.9.0, the 20 features, CV / test macro F1 0.9992 / 0.9994), **What the model relies
on** (global SHAP importance: CGPA 44%, previous SGPA 26%, attendance 21%, ...), the tiles (100% of
the 50,000 latest predictions come from the model; model and policy agree on 99.91%; the policy has
raised 0 labels), **How a prediction is made** (5 stages) and the **Limitations** box (synthetic,
policy-derived labels; early-warning benchmark macro F1 0.934). Every prediction view carries a small
**Random Forest model** badge (or **Rule estimate - ML service offline** when the ML service is down:
stop it and refresh a student to show the fallback).

### What-if (nothing is saved)

As `ayesha.khan@smartedu.edu`: **My classes** → the AI class with **Rabia Gill (BU-100040)** →
click her row → **What if?** tab. She is **Safe** (100% attendance). Drag **Attendance** to **55%**:
the result turns **Dropout-Likely**, the badge still says **Random Forest model** (it is the model's
own label, not a rule), and **Attendance 55% ↑ raises risk** jumps to the top of the drivers. Drag
the marks down instead to show SGPA / projected CGPA being recomputed. **Back to today's numbers**
resets it. Admin: Interventions → click a student's name → **What if?**. Nothing is stored: her
prediction history is unchanged afterwards.

### Upload with errors (CS401 A, `bilal.raza@smartedu.edu`)

File: [`docs/demo_files/demo_marks_upload_CS401_A.csv`](demo_files/demo_marks_upload_CS401_A.csv)
(the class's real marks, a weak midterm/final for Anum Cheema, and **2 deliberate errors**: the quiz
mark `8O` (letter O) on row 4 and roll number `BU-100099`, who isn't in the class, on row 10).

1. Log in as `bilal.raza@smartedu.edu` → **My classes** → **CS401 Operating Systems** → **Upload** tab.
2. Keep **Marks**; optionally **Download marks template** (the roster, marks empty).
3. Drop the demo file on the box. The preview shows **9 rows · 7 valid · 2 with errors**, both
   errors listed and highlighted in the table (the bad cell shows `8O`). Nothing is saved yet.
4. **Save 7 valid rows** → **Rows saved 7 · Rows rejected 2 · Students re-predicted 7 · Labels
   changed 1**: **BU-129601 Anum Cheema: Safe → At-Risk** (projected CGPA 2.40 → 2.21).
5. **Students** tab: the saved rows carry a small **live** tag; the upload is in the history.

**To undo it:** upload [`docs/demo_files/demo_marks_undo_CS401_A.csv`](demo_files/demo_marks_undo_CS401_A.csv)
(Anum's original marks) the same way: she goes back to **Safe**. The rows stay tagged live and both
uploads stay in the history (that is the audit trail). `npm run screenshots` also uploads to this
class, but only re-saves the current marks.

### Live cohort and evaluation (Objective 7)

Already imported: `evaluation/sample_live_cohort.csv` (30 **SYNTHETIC** students, roll numbers
`SYN-*`) as CS301 section LIVE, taught by Dr. Amina Sheikh, with 8 sessions of attendance uploaded.
To show it: Admin → Overview → **Data sources** (30 live students) → **Interventions** → **Data
source: With live data**; log in as `amina.sheikh@smartedu.edu` → **CS301 LIVE**. The import page is
Admin → Overview → Data sources → **Import a live cohort**.

Run the evaluation (database running):

```powershell
python -m pip install -r evaluation/requirements.txt   # once
python evaluation/live_eval.py                          # -> docs/live_eval.md, docs/live_eval_confusion.png
```

Current result: 30 students, accuracy 1.000 against the synthetic outcomes, model vs policy 27/30
(three students at exactly 75% attendance: rule says Safe, model says At-Risk). It is a pipeline test,
not real-world accuracy, and the report says so.

To start again from scratch: `cd backend; node src/scripts/removeLiveCohort.js` (lists imports) →
`node src/scripts/removeLiveCohort.js <id>`, then import the file again on the admin page, press
**Run predictions for this class**, and upload attendance as Dr. Sheikh.

## Forced password change

Accounts created in **Users** get a temporary password and `must_reset_pw = TRUE`: after login
they see only **Set a new password** (8+ characters, upper case, lower case and a digit, different
from the temporary one); every other API call answers 403 `PASSWORD_RESET_REQUIRED` until then.
All imported students, seeded faculty and the `createAdmin.js` admin have `must_reset_pw = FALSE`
(migration 005), so the demo accounts above log in normally. Anyone can change their password
from **Account → Change password**.
