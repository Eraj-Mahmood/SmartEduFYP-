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
| Faculty | Dr. Ayesha Khan (AI) | `ayesha.khan@smartedu.edu` | `Faculty@123` | Teaches AI301 and AI302 section A (classes 16 and 17). Four of the six demo students are in her classes, covering all three labels. Counsellor of BU-122785, BU-112907 and BU-114400 with a session history (Phase 7 demo). |
| Faculty | Mr. Bilal Raza (CS) | `bilal.raza@smartedu.edu` | `Faculty@123` | Teaches CS401 section A (class 4, no demo students): the **upload demo** class. |
| Faculty | Dr. Amina Sheikh (CS) | `amina.sheikh@smartedu.edu` | `Faculty@123` | Teaches the **live cohort** class (CS301 section LIVE, class 26, 30 SYNTHETIC students `SYN-*`). |

## Students (password `Student@123` for all)

"Grades" are in course-code order. For AI students that is AI301, AI302, AI401 and AI402.
AI301 and AI302 are Dr. Khan's courses.

| Label | Name | Roll no | Email | Dept | CGPA | Grades | Why it's a good demo case |
|---|---|---|---|---|---|---|---|
| Safe | Sana Raza | BU-100040 | `student100040@smartedu.edu` | AI | 2.91 | B, B, B, B | Mid-range CGPA but 100% attendance, 100% submission and no failed courses. Shows Safe isn't just "high CGPA". |
| Safe | Aiman Gill | BU-106864 | `student106864@smartedu.edu` | Business | 3.90 | A, A, A, A | Clear top performer on a scholarship. Straight A's, 91% attendance, all credits passed. |
| At-Risk | Ayesha Akhtar | BU-122785 | `student122785@smartedu.edu` | AI | 1.97 | C, C, C, C | Borderline CGPA with 2 failed courses and 2 warnings (12 of 18 credits passed), although attendance is 81%. Exactly the student an advisor should catch early. |
| At-Risk | Zain Khan | BU-112907 | `student112907@smartedu.edu` | AI | 2.24 | C, B, C, C | No failed courses, but CGPA is falling (2.47 → 2.24) and study time is low (9.7 h/week). An early-warning case; the live re-prediction demo moves him to Safe. |
| Dropout-Likely | Farah Javed | BU-144766 | `student144766@smartedu.edu` | AI | 1.62 | C, D, C, C | 3 warnings, consecutive low CGPA, 62.5% attendance and 55% submission. Grades close to BU-122785's but a worse label: shows the model weighs behaviour, not only grades. |
| Dropout-Likely | Omar Akhtar | BU-101986 | `student101986@smartedu.edu` | Business | 1.02 | D, D, D, D | Severe case: 3 failed courses, only 9 of 18 credits passed, 62.5% attendance. |

Names come from `database/generate_student_names.py` (fixed seed 2026, run by `npm run demo:reset`).
It only rewrites `students.full_name`, never emails, roll numbers or IDs. The names changed on
2026-11-07 when the seed was fixed (e.g. BU-144766 was "Nida Shah"); a different `--seed` changes them again.

**Why the names changed again (2026-11-08):** `import_dataset.py` used to sort the CSV with
`sort_values("Semester")`, an unstable sort, so the order in which students were inserted - and therefore
`students.student_id` and the name each student got - depended on the NumPy version (BU-112907 was "Nabeel Dar"
in these docs but "Talha Riaz" or "Hassan Aziz" on other machines). It now sorts on `["Semester", "Student_ID"]`
with `kind="stable"`, which fixes the order completely, so every machine gets the names in this file. Old
names: BU-100040 Zainab Shah, BU-106864 Ayesha Naqvi, BU-122785 Ayesha Raza, BU-112907 Nabeel Dar, BU-144766
Sobia Butt, BU-101986 Danish Tariq, BU-145871 Danish Farooq. Roll numbers, emails, marks and labels did not change.

## Live re-prediction demo

Faculty saves re-predict the student straight away. A realistic change that moves a label:

1. Log in as `ayesha.khan@smartedu.edu` → **My classes** → **View class** on **AI301 · Section A**.
2. In the **BU-112907** (Zain Khan) row change **Quiz 54.99 → 75** and **Midterm 70.50 → 88** (keep
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

Log in as **Farah Javed** (`student144766@smartedu.edu`, Dropout-Likely) and open **Ask SmartEdu**
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

1. **Admin** (`admin@smartedu.edu`) → **Interventions** → search `BU-144766` (Farah Javed, Dropout-Likely).
   The row shows the weakest course **AI302 (avg 53)**, its tutorial **MIT Introduction to Deep
   Learning (6.S191)**, Counselor **Assign** and Last intervention **never**.
   - Press **Assign** → the picker lists Artificial Intelligence faculty first with their current
     counselee counts → choose **Dr. Ayesha Khan** → **Assign**. A toast confirms; the row now
     shows "Dr. Ayesha Khan · not contacted yet".
   - Press **Send** → keep the template (it uses `{name}`, `{course}` and `{counselor}`) and
     "Add each student's recommended tutorial". The preview shows Farah's own copy ending with
     `Recommended for AI302: "MIT Introduction to Deep Learning (6.S191)" - https://introtodeeplearning.com/`.
     Press **Send**; Last intervention becomes "just now".
2. **Student** (`student144766@smartedu.edu`): the bell shows **2 unread** (the counselor notice
   and the intervention). **What to do next** shows the counselor card (Dr. Ayesha Khan, Associate
   Professor, a mailto link, "Assigned just now"), the tutorial card with **Open tutorial**, and
   the ranked next steps. Clicking the intervention in the bell scrolls to that card. Asking
   SmartEdu "Who can help me?" now names Dr. Khan and her email.
3. **Faculty** (`ayesha.khan@smartedu.edu`) → **My counselees**: Farah Javed with her label, main
   reason and "Not contacted yet". Opening her shows the next steps, the tutorial and a notes box
   that saves itself ("Saved"); **Mark contacted today** and **Close assignment** are at the bottom.
   The bell has "You've been assigned as counselor to Farah Javed (Dropout-Likely)"; clicking it
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

As `ayesha.khan@smartedu.edu`: **My classes** → the AI class with **Sana Raza (BU-100040)** →
click her row → **What if?** tab. She is **Safe** (100% attendance). Drag **Attendance** to **55%**:
the result turns **Dropout-Likely**, the badge still says **Random Forest model** (it is the model's
own label, not a rule), and **Attendance 55% ↑ raises risk** jumps to the top of the drivers. Drag
the marks down instead to show SGPA / projected CGPA being recomputed. **Back to today's numbers**
resets it. Admin: Interventions → click a student's name → **What if?**. Nothing is stored: her
prediction history is unchanged afterwards.

### Upload with errors (CS401 A, `bilal.raza@smartedu.edu`)

File: [`docs/demo_files/demo_marks_upload_CS401_A.csv`](demo_files/demo_marks_upload_CS401_A.csv)
(the class's real marks after a reset, weak marks for Talha Tariq (BU-145871), and **2 deliberate
errors**: the quiz mark `8O` (letter O) for BU-127235 on row 4 and roll number `BU-100099`, who isn't in
the class, on row 10). If a reset ever changes the marks, regenerate it with
`node ../evaluation/demo_actions_check.js --write-demo-files`.

1. Log in as `bilal.raza@smartedu.edu` → **My classes** → **CS401 Operating Systems** → **Upload** tab.
2. Keep **Marks**; optionally **Download marks template** (the roster, marks empty).
3. Drop the demo file on the box. The preview shows **9 rows · 7 valid · 2 with errors**, both
   errors listed and highlighted in the table (the bad cell shows `8O`). Nothing is saved yet.
4. **Save 7 valid rows** → **Rows saved 7 · Rows rejected 2 · Students re-predicted 7 · Labels
   changed 1**: **BU-145871 Talha Tariq: Safe → At-Risk** (projected CGPA 2.51 → 2.26).
5. **Students** tab: the saved rows carry a small **live** tag; the upload is in the history.

**To undo it:** upload [`docs/demo_files/demo_marks_undo_CS401_A.csv`](demo_files/demo_marks_undo_CS401_A.csv)
(Talha's original marks) the same way: he goes back to **Safe** (2.51). The rows stay tagged live and both
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

## Counselling and probation demo (Phase 7)

`npm run demo:reset` adds this data (fixed; dates counted from the reset day, Pakistan time, so **reset
on the day of the demo**):

| Student | Standing (BU rules) | Counsellor | Sessions with Dr. Ayesha Khan |
|---|---|---|---|
| Ayesha Akhtar, BU-122785, `student122785@smartedu.edu` | Probation 1 of 2 (starting status) | Dr. Ayesha Khan | 28 days ago Present, 21 days ago Absent, 14 days ago Present; **in 2 days, 11:00 AM, Room 204** (upcoming) |
| Zain Khan, BU-112907, `student112907@smartedu.edu` | Good standing | Dr. Ayesha Khan | 20 and 13 days ago Present (online); **yesterday 2:00 PM, Room 204 - Awaiting attendance**; in 3 days 2:00 PM online (upcoming) |
| Bushra Awan, BU-114400, `student114400@smartedu.edu` | Good standing | Dr. Ayesha Khan | 17 days ago Present, 10 days ago Absent |

**Bushra Awan is the semester-close demo student.** She is in Dr. Khan's AI301 and AI302; the reset sets
her two final exams to 32 (both grades stay C), so this term's projected CGPA is 1.97, below the 2.00
minimum - closing the semester puts her on **Probation 1 of 2** with a warning letter. (She is not one of the
six curated students above: their marks and the existing demos are unchanged. BU-144766 Farah Javed still
has no counsellor, for the interventions demo.)

Starting statuses after a reset (BU Student Handbook 5.5, seeded from each student's CGPA): good 26,466 ·
Probation 1 17,381 · Probation 2 0 · not evaluated 6,183 (semester-1 students). Every student below the minimum starts
on **Probation 1 at most** (Phase 7.1): the data has one completed term per student, so it can't prove the earlier
probation that Handbook 5.5.3 needs before a drop - so nobody can be dropped by the first close. Probation is shown
next to the risk label and never changes it.

Use three windows: **Admin**, **Dr. Ayesha Khan** and the student named in each step.

1. **Schedule a session (both notified).** Admin → **Counselling** → **Schedule session** → search
   `BU-122785` → pick **Ayesha Akhtar** (the counsellor fills in as **Dr. Ayesha Khan · 3 counselees
   (current counsellor)**; 4 if the interventions demo already assigned her to Farah) → Date: tomorrow, Time: 10:00, Location: Room 204, Agenda: "Plan for the final
   exams" → **Schedule session**. The toast says "Session booked for <tomorrow>, 10:00 AM". Ayesha Akhtar's
   bell: "Counselling session with Dr. Ayesha Khan on <tomorrow>, 10:00 AM (30 min), Room 204. Agenda: ...";
   Dr. Khan's bell: "Counselling session with Ayesha Akhtar (BU-122785) on ...".
   *Optional:* choose another teacher in the dropdown - the form asks "This makes Mr. Zain Abbas the
   counsellor instead of Dr. Ayesha Khan. Her 1 upcoming session with Dr. Ayesha Khan will be cancelled.
   Continue?" (press **Go back**; **Continue** would cancel that session and notify both people).
2. **The teacher marks it Present.** Dr. Khan → **Counselling**: the first row is **Zain Khan, yesterday 2:00
   PM, Awaiting attendance** (highlighted, with "1 session awaiting your attendance mark"). **Present** → add a
   note ("Reviewed the study plan; on track for the midterm.") → **Save**. It moves to **History** as Present.
   Zain Khan (`student112907@smartedu.edu`) → **Counselling**: the session shows **Present**, "Attended 3 of 3
   sessions so far", and the note is not shown; his bell says the session "was marked Present".
3. **Close the semester -> Probation 1.** Admin → **Standing** → Term `Fall 2026` → **Preview**: 70 students;
   good 38 · Probation 1 4 · Probation 2 28 · Dropped 0; 32 letters. The row **Bushra Awan BU-114400, CGPA
   1.97 / min 2.00, Good -> Probation 1, Level 1**. Tick **"All results for this term, including FYP, are
   final"** → **Close Fall 2026** → **Close the semester**. Toast: "Fall 2026 closed". Bushra Awan
   (`student114400@smartedu.edu`): bell "Academic standing: Probation 1 of 2"; the dashboard card **Academic
   standing (BU rules)** shows Probation 1 of 2, "This term: no marks entered yet" (the closed term is over) and the
   warning letter. Her official CGPA is now 1.97 and her projected CGPA is the same 1.97; her risk label stays
   **Needs attention** (At-Risk) - the closed term's marks are not counted a second time.

   **Who changes at the close** (curated and demo students; risk labels do not change):

   | Student | Standing before -> after |
   |---|---|
   | Bushra Awan BU-114400 | Good -> Probation 1 (CGPA 1.97), letter 1 |
   | Ayesha Akhtar BU-122785 | Probation 1 -> Probation 2 (1.97), letter 2 |
   | Farah Javed BU-144766 | Probation 1 -> Probation 2 (1.62), letter 2 |
   | Naveed Awan BU-115624 | Probation 1 -> Probation 2 (1.16), letter 2 |
   | Omar Akhtar BU-101986 | Not evaluated -> Probation 1 (semester-1 GPA 1.00), letter 1 |
   | Sana Raza BU-100040, Imran Aziz BU-148379 | Good -> Good; final semester, they stay in semester 8 |
   | Zain Khan BU-112907, Aiman Gill BU-106864, Talha Tariq BU-145871 | no change |

   The close also **ends the term**: the 190 enrolments become *completed*, so the class rosters are empty, those
   classes take no more marks or attendance, and a second close (any term name) is refused with "nothing to close".
   Run `npm run demo:reset -- --yes` to repeat it.
4. **Schedule counselling from the probation list.** Admin → **Standing** → *Students on probation* → search
   `BU-114400` → **Schedule session**: the form is pre-filled (Bushra Awan, Dr. Ayesha Khan, agenda
   "Probation follow-up (Probation 1 of 2, Fall 2026): CGPA 1.97 ...") → pick tomorrow, 3:00 PM, Room 204 →
   **Schedule session**. **Letter 1** in the same row opens the print view (**Print / Save as PDF**).
5. **The student acknowledges the letter.** Bushra Awan → dashboard → *Warning letters* → **I acknowledge this
   letter**. It shows "Acknowledged by the student on ..."; in the admin probation list the letter is no
   longer "not acknowledged".

Also worth showing: Admin **Overview** (Probation 1 / Probation 2 / Dropped tiles), the **Standing** filter on
**Interventions** and **Users**, after the close a Probation 2 student's enrolment hold on **Assignments** (e.g.
enrol `BU-144766` Farah Javed in a CS class - refused with "Record approval"; nobody is on Probation 2 before the
close), and the chat: "Am I on probation?", "meri counselling kab
hai?", "What happens if my CGPA stays below 2?".

**Verified 2026-11-09** by `cd backend; node ../evaluation/phase7_demo_check.mjs` (performs steps 1-5 in a real
browser and checks each result; screenshots in `docs/screenshots/phase7_demo/`). The actions change the data:
**`npm run demo:reset` afterwards** (and before a presentation).

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
