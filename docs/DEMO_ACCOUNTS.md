# Demo accounts

Accounts for demoing SmartEdu. For each student, the course grades, the CGPA, the
dataset label and the live model prediction all agree.

**Rebuild this exact data at any time:** `cd backend; npm run demo:reset` (ML service running;
see the script header). The reset is deterministic: same seed and date, identical rows. Every
demo action below was performed and reverted through the API on 2026-11-07 by
`cd backend; node ../evaluation/demo_actions_check.js` (all checks pass); run it after a reset
to re-verify, then reset again for a pristine database (reverting leaves rows tagged `live`).

Passwords are the defaults from the setup scripts: `createAdmin.js` (as run in the README),
`seed_demo_data.py` (`Faculty@123`) and `import_dataset.py` (`Student@123`).

> These students are enrolled by `seed_demo_data.py`, which uses a fixed list of 8 students per
> department (`PINNED_STUDENTS`, the original random pick) and derives each course mark from the
> student's CGPA, so all 40 enrolled students pass `database/find_consistent_demo_students.sql`.

## Where to sign in (separate portals)

Open http://localhost:5173/ and choose a portal: **Student** (`/login/student`), **Faculty**
(`/login/faculty`) or **Admin** (`/login/admin`). Each account only signs in through its own portal.

**Wrong-portal demo:** on the Faculty sign in, enter `student100040@smartedu.edu` / `Student@123`. The
form says **"This is a student account - please use the Student sign in"** with a **Go to Student sign
in** button (the email is kept); no session is created. A wrong password gives the same "Invalid email
or password" on every portal, so the portals never reveal which accounts exist.

## Staff

| Role | Name | Email | Password | Why |
|---|---|---|---|---|
| Admin | — | `admin@smartedu.edu` | `Admin@123` | Sees all students, predictions and interventions. |
| Faculty | Dr. Ayesha Khan (AI) | `ayesha.khan@smartedu.edu` | `Faculty@123` | Teaches AI301 and AI302 section A (classes 16 and 17). Four of the six demo students are in her classes, covering all three labels. |
| Faculty | Mr. Bilal Raza (CS) | `bilal.raza@smartedu.edu` | `Faculty@123` | Teaches CS401 section A (class 4, no demo students): the **upload demo** class. |
| Faculty | Dr. Amina Sheikh (CS) | `amina.sheikh@smartedu.edu` | `Faculty@123` | Teaches the **live cohort** class (CS301 section LIVE, class 26, 30 SYNTHETIC students `SYN-*`). |

## Students (password `Student@123` for all)

"Grades" are in course-code order. For AI students that is AI301, AI302, AI401 and AI402.
AI301 and AI302 are Dr. Khan's courses.

| Label | Name | Roll no | Email | Dept | CGPA | Grades | Why it's a good demo case |
|---|---|---|---|---|---|---|---|
| Safe | Zainab Shah | BU-100040 | `student100040@smartedu.edu` | AI | 2.91 | B, B, B, B | Mid-range CGPA but 100% attendance, 100% submission and no failed courses. Shows Safe isn't just "high CGPA". |
| Safe | Ayesha Naqvi | BU-106864 | `student106864@smartedu.edu` | Business | 3.90 | A, A, A, A | Clear top performer on a scholarship. Straight A's, 91% attendance, all credits passed. |
| At-Risk | Ayesha Raza | BU-122785 | `student122785@smartedu.edu` | AI | 1.97 | C, C, C, C | Borderline CGPA with 2 failed courses and 2 warnings (12 of 18 credits passed), although attendance is 81%. Exactly the student an advisor should catch early. |
| At-Risk | Nabeel Dar | BU-112907 | `student112907@smartedu.edu` | AI | 2.24 | C, B, C, C | No failed courses, but CGPA is falling (2.47 → 2.24) and study time is low (9.7 h/week). An early-warning case; the live re-prediction demo moves him to Safe. |
| Dropout-Likely | Sobia Butt | BU-144766 | `student144766@smartedu.edu` | AI | 1.62 | C, D, C, C | 3 warnings, consecutive low CGPA, 62.5% attendance and 55% submission. Grades close to BU-122785's but a worse label: shows the model weighs behaviour, not only grades. |
| Dropout-Likely | Danish Tariq | BU-101986 | `student101986@smartedu.edu` | Business | 1.02 | D, D, D, D | Severe case: 3 failed courses, only 9 of 18 credits passed, 62.5% attendance. |

Names come from `database/generate_student_names.py` (fixed seed 2026, run by `npm run demo:reset`).
It only rewrites `students.full_name`, never emails, roll numbers or IDs. The names changed on
2026-11-07 when the seed was fixed (e.g. BU-144766 was "Nida Shah"); a different `--seed` changes them again.

## Live re-prediction demo

Faculty saves re-predict the student straight away. A realistic change that moves a label:

1. Log in as `ayesha.khan@smartedu.edu` → **My classes** → **View class** on **AI301 · Section A**.
2. In the **BU-112907** (Nabeel Dar) row change **Quiz 54.99 → 75** and **Midterm 70.50 → 88** (keep
   Assignment 70.98 and Final 79.31) and press **Save** (or Enter). Without a page reload:
   - the grade cell changes **C → B** (derived on the server),
   - the risk chip changes **Needs attention → Safe**,
   - a toast reads **"BU-112907: At-Risk → Safe"**.
3. Log in as `student112907@smartedu.edu`: the status is **"You're on track"** (Safe), with projected
   CGPA 2.32, now above the 2.30 good-standing threshold.

To undo it, type the original marks again (Quiz 54.99, Midterm 70.50) and save; the student goes back to
At-Risk (C). The row then carries a small **live** tag; `npm run demo:reset` removes it.

Admin part of the demo: **Overview → Run predictions → Department → Artificial Intelligence → Start run**.
The progress bar fills in about 15 seconds and the charts refresh when it finishes.

## Chat demo ("Ask SmartEdu")

Log in as **Sobia Butt** (`student144766@smartedu.edu`, Dropout-Likely) and open **Ask SmartEdu**
on the dashboard (or press **Ask about this** under "Why", which sends question 1 for you).
These four questions show the assistant best. Every answer comes from the templates (Layer 1):
no LLM or API key is needed, and the ML service can be stopped.

| # | Ask | What it shows |
|---|---|---|
| 1 | `Why is my status this?` | The label in supportive wording ("High risk - let's act now"), three reasons (CGPA 1.62 in the high-risk range, last term's SGPA 1.64, 2 failed courses) and a reminder that this is a warning, not a final result. |
| 2 | `meri attendance kaisi hai?` | Roman Urdu understood: 62.5% (20 of 32), attendance per course (AI401 is the weak one at 25%), and "attend the next 16 classes without missing one to reach 75%". |
| 3 | `How can I improve?` | The ranked next steps with real targets: average 85 (A) to reach the 2.30 Safe line (now 63), 75 (B) for 2.00, the attendance condition, then AI302 (average 53, D) with its study material. |
| 4 | `What is BU-122785's CGPA?` | Refusal. It never confirms whether that student exists and shows none of their numbers. |

Other good ones: `Tell me about Natural Language Processing` (course by title), `What are my marks in CS301?`
("isn't one of your courses"), `I'm so stressed about my exams` (wellbeing reply with the support contacts
from `backend/src/config/support.json`). To start the demo clean, use **Clear chat** in the panel.

## Interventions demo (demo script step 6)

Shows the Phase 4 workflow: a flagged student ends up with a named counselor, a tutorial for
their weakest course and an intervention message. Checked through the API on 2026-11-07
(`demo_actions_check.js`). Use three browser windows (or one private window per account).

1. **Admin** (`admin@smartedu.edu`) → **Interventions** → search `BU-144766` (Sobia Butt, Dropout-Likely).
   The row shows the weakest course **AI302 (avg 53)**, its tutorial **MIT Introduction to Deep
   Learning (6.S191)**, Counselor **Assign** and Last intervention **never**.
   - Press **Assign** → the picker lists Artificial Intelligence faculty first with their current
     counselee counts → choose **Dr. Ayesha Khan** → **Assign**. A toast confirms; the row now
     shows "Dr. Ayesha Khan · not contacted yet".
   - Press **Send** → keep the template (it uses `{name}`, `{course}` and `{counselor}`) and
     "Add each student's recommended tutorial". The preview shows Sobia's own copy ending with
     `Recommended for AI302: "MIT Introduction to Deep Learning (6.S191)" - https://introtodeeplearning.com/`.
     Press **Send**; Last intervention becomes "just now".
2. **Student** (`student144766@smartedu.edu`): the bell shows **2 unread** (the counselor notice
   and the intervention). **What to do next** shows the counselor card (Dr. Ayesha Khan, Associate
   Professor, a mailto link, "Assigned just now"), the tutorial card with **Open tutorial**, and
   the ranked next steps. Clicking the intervention in the bell scrolls to that card. Asking
   SmartEdu "Who can help me?" now names Dr. Khan and her email.
3. **Faculty** (`ayesha.khan@smartedu.edu`) → **My counselees**: Sobia Butt with her label, main
   reason and "Not contacted yet". Opening her shows the next steps, the tutorial and a notes box
   that saves itself ("Saved"); **Mark contacted today** and **Close assignment** are at the bottom.
   The bell has "You've been assigned as counselor to Sobia Butt (Dropout-Likely)"; clicking it
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
(Kashif Riaz) with Mr. Zain Abbas as counselor and closes that assignment at the end.

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

As `ayesha.khan@smartedu.edu`: **My classes** → the AI class with **Zainab Shah (BU-100040)** →
click her row → **What if?** tab. She is **Safe** (100% attendance). Drag **Attendance** to **55%**:
the result turns **Dropout-Likely**, the badge still says **Random Forest model** (it is the model's
own label, not a rule), and **Attendance 55% ↑ raises risk** jumps to the top of the drivers. Drag
the marks down instead to show SGPA / projected CGPA being recomputed. **Back to today's numbers**
resets it. Admin: Interventions → click a student's name → **What if?**. Nothing is stored: her
prediction history is unchanged afterwards.

### Upload with errors (CS401 A, `bilal.raza@smartedu.edu`)

File: [`docs/demo_files/demo_marks_upload_CS401_A.csv`](demo_files/demo_marks_upload_CS401_A.csv)
(the class's real marks after a reset, weak marks for Danish Farooq (BU-145871), and **2 deliberate
errors**: the quiz mark `8O` (letter O) for BU-127235 on row 4 and roll number `BU-100099`, who isn't in
the class, on row 10). If a reset ever changes the marks, regenerate it with
`node ../evaluation/demo_actions_check.js --write-demo-files`.

1. Log in as `bilal.raza@smartedu.edu` → **My classes** → **CS401 Operating Systems** → **Upload** tab.
2. Keep **Marks**; optionally **Download marks template** (the roster, marks empty).
3. Drop the demo file on the box. The preview shows **9 rows · 7 valid · 2 with errors**, both
   errors listed and highlighted in the table (the bad cell shows `8O`). Nothing is saved yet.
4. **Save 7 valid rows** → **Rows saved 7 · Rows rejected 2 · Students re-predicted 7 · Labels
   changed 1**: **BU-145871 Danish Farooq: Safe → At-Risk** (projected CGPA 2.51 → 2.26).
5. **Students** tab: the saved rows carry a small **live** tag; the upload is in the history.

**To undo it:** upload [`docs/demo_files/demo_marks_undo_CS401_A.csv`](demo_files/demo_marks_undo_CS401_A.csv)
(Danish's original marks) the same way: he goes back to **Safe** (2.51). The rows stay tagged live and both
uploads stay in the history (that is the audit trail). `npm run screenshots` also uploads to this
class, but restores it exactly (rows, tags, uploads, predictions) when it finishes, even after a failure.

### Live cohort and evaluation (Objective 7)

Imported by `npm run demo:reset`: `evaluation/sample_live_cohort.csv` (30 **SYNTHETIC** students, roll
numbers `SYN-*`) as CS301 section LIVE (class 26, upload #1), taught by Dr. Amina Sheikh, and predicted
in the reset's full run. No attendance sessions are uploaded, so their attendance is the file's value.
To show it: Admin → Overview → **Data sources** (30 live students) → **Interventions** → **Data
source: With live data**; log in as `amina.sheikh@smartedu.edu` → **CS301 LIVE**. The import page is
Admin → Overview → Data sources → **Import a live cohort**.

Run the evaluation (database running):

```powershell
python -m pip install -r evaluation/requirements.txt   # once
python evaluation/live_eval.py                          # -> docs/live_eval.md, docs/live_eval_confusion.png
```

Current result (after `demo:reset`, 2026-11-07): 30 students, all from the model, accuracy 1.000 and
macro F1 1.000 against the synthetic outcomes, model vs policy 30/30. (The earlier 27/30 came from 8
uploaded attendance sessions that put three students at exactly 75%; the reset does not upload them.)
It is a pipeline test, not real-world accuracy, and the report says so.

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

**Admin password reset:** Admin → **Users** → find the account → **Reset password** → **Reset
password** again to confirm. A box shows a 12-character temporary password **once** (Copy button) and
the portal to use; the old password and every open session stop working at once, and the next sign-in
must set a new password. The audit log records `RESET_PASSWORD` (who, for whom - never the password).

**Signing in as a live-cohort student:** imported `SYN-*` accounts have an unknown random password.
Reset one as above (e.g. search `SYN-101155`, email `live.syn-101155@smartedu.edu`), sign in at
**Student sign in** with the temporary password, set a new one, and the dashboard shows the imported
CS301 marks. `npm run demo:reset` puts every account back as it was.
