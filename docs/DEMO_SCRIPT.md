# SmartEdu - 12-minute demo script

One presenter, one laptop, one browser window (use a private/incognito window so no old session is open).
Every account, number and name below is from a fresh `npm run demo:reset` (see [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md)).
The chat part uses only questions the built-in assistant (Layer 1) answers - **no internet and no Gemini needed**.

Rehearsed end to end with Playwright on 2026-11-08 (`evaluation/demo_run.js`, video in `docs/demo_recording/`):
every step below worked as written; the automated run with the pauses for talking took the time noted at the end.
Block 6 (counselling and probation, Phase 7) was added on 2026-11-09 and is checked by
`evaluation/phase7_demo_check.mjs`; the recorded video predates it. Phase 7.1 (2026-11-09) moved the wrong-portal
attempt to block 5 so the semester close is always the last block, and updated the close numbers; walked end to end on
2026-11-09 after a reset: `demo_run.js` 35/35 (blocks 1-5), then `phase7_demo_check.mjs` 17/17 (block 6) on the same data.

## Before the audience arrives (15 minutes before)

1. Double-click `start.cmd` in the project folder; wait for three green **OK** lines (it opens the browser).
2. In a new PowerShell window: `cd backend; npm run demo:reset -- --yes` (about 3-6 minutes; it ends with "Demo reset finished").
   **Reset on the day of the demo:** the counselling sessions are dated from the reset day (block 6 needs Zain Khan's
   session "yesterday" to be awaiting attendance).
3. Browser: zoom 100-110%, close other tabs, open http://localhost:5173/ (the portal chooser).
4. Keep this page open beside you, or printed. Passwords: admin `Admin@123`, faculty `Faculty@123`, students `Student@123`.

## The demo

| # | Time | Click / type | Say | The audience sees |
|---|---|---|---|---|
| **1** | **0:00** | **Portal chooser and admin** | | |
| 1.1 | 0:00 | (Chooser already open) | "SmartEdu predicts which students are likely to struggle, early enough to help. Students, faculty and admins each have their own sign-in." | Three portals: Student, Faculty, smaller Admin |
| 1.2 | 0:20 | **Admin** -> `admin@smartedu.edu` / `Admin@123` -> **Sign in** | "The admin sees all 50,000 students." | Overview: KPIs (50,030 students), risk charts, data sources |
| 1.3 | 0:40 | **Run predictions** card -> keep **Department** -> choose **Artificial Intelligence** -> **Start run** | "Every prediction comes from our trained Random Forest. Let's re-score one department live." | Progress bar fills in ~10 s, "completed", the charts refresh |
| 1.4 | 1:10 | Top menu **Model** | "This page proves it's a real machine-learning model, not rules." | Model card: RandomForestClassifier, 300 trees, 20 features, test macro F1 0.9994; "What the model relies on" (CGPA 44%, previous SGPA 26%, attendance 21%); 100% of predictions from the model; model and policy agree 99.91% |
| 1.5 | 1:40 | **Account** -> **Log out** | | Back on the Admin sign-in |
| **2** | **1:50** | **Student portal** | | |
| 2.1 | 1:50 | SmartEdu logo -> **Student** -> `student144766@smartedu.edu` / `Student@123` | "Farah Javed, an AI student." | Dashboard: **High risk - let's act now** |
| 2.2 | 2:05 | Point at **Why** and the badge | "The status comes with reasons in plain language - and the badge shows the Random Forest made this call." | Reasons: CGPA 1.62 in the high-risk range, last term's SGPA 1.64, failed courses; badge **Random Forest model** |
| 2.3 | 2:25 | Scroll: CGPA tiles, **What to do next**, charts | "She sees where she stands and exactly what to do next." | Official vs projected CGPA, attendance 62.5%, next steps with real targets, marks by course (AI302 lowest) |
| 2.4 | 2:50 | **Ask SmartEdu** -> type `Why am I at risk?` -> Enter | "Students can ask in their own words." | Label, the reasons, "this is a warning, not a final result" |
| 2.5 | 3:15 | Type `meri attendance kaisi hai?` -> Enter | "It understands Roman Urdu." | 62.5% (20 of 32), per course, "attend the next 16 classes ... to reach 75%" |
| 2.6 | 3:40 | Type `What is BU-122785's CGPA?` -> Enter | "And it protects other students' privacy." | A refusal that never confirms the other student exists |
| 2.7 | 4:00 | Close the panel -> **Account** -> **Log out** | | Student sign-in |
| **3** | **4:10** | **Faculty portal** | | |
| 3.1 | 4:10 | Logo -> **Faculty** -> `ayesha.khan@smartedu.edu` / `Faculty@123` | "Dr. Ayesha Khan teaches two AI classes." | My classes with risk bars |
| 3.2 | 4:25 | **View class** on **AI301 · Section A** | "She sees risk in her class at a glance." | Risk in this class (2 on track, 3 need attention, 3 high risk), grade distribution, attendance by session |
| 3.3 | 4:45 | Row **BU-112907** (Zain Khan): **Quiz** `75`, **Midterm** `88` -> **Save** | "When she enters marks, the model re-scores the student immediately." | Grade C -> B, chip turns **Safe**, toast **"BU-112907: At-Risk -> Safe"** |
| 3.4 | 5:15 | Click **Sana Raza (BU-100040)** -> **What if?** tab -> drag **Attendance** to **55** | "What if she stopped attending? Nothing is saved - it's a simulation with the same model." | **Safe -> Dropout-Likely**, attendance at the top of the drivers, badge still "Random Forest model" |
| 3.5 | 5:50 | Close the drawer -> **Account** -> **Log out** -> **Faculty** -> `bilal.raza@smartedu.edu` / `Faculty@123` | "Teachers can also upload a whole class's marks at once." | Mr. Bilal Raza's classes |
| 3.6 | 6:05 | **CS401** -> **Upload** tab -> drop `docs/demo_files/demo_marks_upload_CS401_A.csv` on the box | "The file has two mistakes on purpose." | Preview: 9 rows, 7 valid, 2 errors (quiz `8O` on row 4, a student not in this class on row 10), highlighted |
| 3.7 | 6:30 | **Save 7 valid rows** | "Good rows are saved, bad ones are explained, and the class is re-predicted." | Saved 7, rejected 2, labels changed 1: **BU-145871 Talha Tariq Safe -> At-Risk** |
| 3.8 | 6:50 | **Account** -> **Log out** | | |
| **4** | **7:00** | **Admin: counselor and intervention** | | |
| 4.1 | 7:00 | **Admin** sign-in -> **Interventions** -> search `BU-144766` | "Back to the admin, who acts on the flagged list." | Farah's row: weakest course AI302 (avg 53), tutorial "MIT Introduction to Deep Learning", Counselor **Assign** |
| 4.2 | 7:20 | **Assign** -> choose **Dr. Ayesha Khan** -> **Assign** | "Assign a counselor - AI faculty first, with their workloads." | Toast; row shows "Dr. Ayesha Khan · not contacted yet" |
| 4.3 | 7:45 | **Send** -> keep the template and "Add each student's recommended tutorial" -> **Send** | "Send a personal message with study material for her weakest course." | Preview ends with "Recommended for AI302 ..."; Last intervention "just now" |
| 4.4 | 8:10 | **Log out** -> **Student** -> `student144766@smartedu.edu` | "What does Farah see?" | Bell shows **2**; What to do next: counselor card (Dr. Ayesha Khan, email) and **Open tutorial** |
| 4.5 | 8:45 | **Log out** | | |
| **5** | **8:55** | **Wrong-portal attempt** | | |
| 5.1 | 8:55 | **Faculty** sign-in with `student144766@smartedu.edu` / `Student@123` | "Each account only works in its own portal." | **"This is a student account - please use the Student sign in"** with a button; no session |
| 5.2 | 9:15 | Same form, wrong password `Wrong-pass1` | "A wrong password never reveals whether an account exists." | "Invalid email or password" |
| 5.3 | 9:30 | Back to the chooser | "Last, the academic rules." | Portal chooser |
| **6** | **9:40** | **Counselling and probation (BU rules) - always the last block** | | |
| 6.1 | 9:40 | **Admin** sign-in -> **Counselling** -> **Schedule session** -> search `BU-122785` -> **Ayesha Akhtar** -> Date tomorrow, Time `10:00`, Location `Room 204` -> **Schedule session** | "Admins book counselling sessions. The counsellor fills in automatically, and both people are notified." | Counsellor **Dr. Ayesha Khan · 4 counselees (current counsellor)** (4: Farah was assigned to her in 4.2); toast "Session booked for ..., 10:00 AM"; the row shows **Upcoming** |
| 6.2 | 10:05 | **Log out** -> **Faculty** -> `ayesha.khan@smartedu.edu` -> **Counselling** -> first row (Zain Khan, yesterday 2:00 PM) -> **Present** -> **Save** | "The counsellor records attendance afterwards - nothing is ever marked absent automatically." | "Awaiting attendance" row highlighted; after Save it moves to **History** as **Present** |
| 6.3 | 10:25 | **Log out** -> **Admin** -> **Standing** -> Term `Fall 2026` -> **Preview** | "Probation follows the BU Student Handbook, clause 5.5 - a rule outcome, shown next to the risk prediction, never mixed with it." | 70 students: **good 38 · Probation 1 4 · Probation 2 28 · Dropped 0; 32 letters**. **Bushra Awan BU-114400: Good -> Probation 1, CGPA 1.97 / min 2.00, letter 1** |
| 6.4 | 10:45 | Tick **"All results ... are final"** -> **Close Fall 2026** -> **Close the semester** | "Results must be final first - handbook 1.20.4. One click records every decision, issues the warning letters, notifies the students and ends the term." | Toast "Fall 2026 closed"; the probation list now has letters |
| 6.5 | 11:05 | *Students on probation* -> search `BU-114400` -> **Schedule session** -> tomorrow `15:00`, `Room 204` -> **Schedule session** | "From the probation list, counselling is one click away - the form is already filled in." | Agenda "Probation follow-up (Probation 1 of 2, Fall 2026) ..."; session booked |
| 6.6 | 11:25 | **Log out** -> **Student** -> `student114400@smartedu.edu` -> dashboard -> *Warning letters* -> **I acknowledge this letter** | "Bushra sees both: her risk prediction from the model, and her academic standing under the BU rules." | **Risk prediction (Random Forest)** hero (still **Needs attention** - the close does not change the risk label) and the **Academic standing (BU rules)** card: Probation 1 of 2, official CGPA 1.97, "no marks for the new term yet", the letter -> "Acknowledged by the student on ..." |
| 6.7 | 11:50 | **Log out** -> back to the chooser | Wrap up: "Real model, explained predictions, live updates, interventions, counselling and academic probation, and privacy - all tested: 656 API tests, 72 manual test cases, 50,000 students re-scored in under 2 minutes." | Portal chooser |

**Who changes when Fall 2026 is closed (6.4)** - so nothing surprises you afterwards. Risk labels do **not** change: after
the close each student's projected CGPA equals the new official CGPA (the closed term's marks are not counted twice).

| Student | Standing before -> after | Note |
|---|---|---|
| Bushra Awan BU-114400 | Good -> **Probation 1** (CGPA 1.97) | the planned demo moment; warning letter 1 |
| Ayesha Akhtar BU-122785 | Probation 1 -> **Probation 2** (1.97) | letter 2; needs the Principal's approval to enrol |
| Farah Javed BU-144766 | Probation 1 -> **Probation 2** (1.62) | letter 2; her chat now says Probation 2 |
| Naveed Awan BU-115624 | Probation 1 -> **Probation 2** (1.16) | letter 2 |
| Omar Akhtar BU-101986 | Not evaluated -> **Probation 1** (semester-1 GPA 1.00) | letter 1 |
| Sana Raza BU-100040, Imran Aziz BU-148379 | Good -> Good | final semester (8): they stay in semester 8 |
| Zain Khan, Aiman Gill, Talha Tariq | Good -> Good | no change |

Nobody is dropped at the first close: every student starts at most on Probation 1 (a drop needs two probations first).
After the close the term is over: those classes take no more marks or attendance, and a second close is refused with
"nothing to close".

## Reset between rehearsals

Everything above changes demo data (a mark, an upload, a counselor, notifications, chat history, counselling sessions,
the semester close). To get it all back:

```powershell
cd backend
npm run demo:reset -- --yes      # ML service running; about 3 minutes; identical data every time
```

Quick manual undo if there is no time for a reset (see DEMO_ACCOUNTS.md for details): type BU-112907's old marks back
(Quiz 54.99, Midterm 70.50); upload `docs/demo_files/demo_marks_undo_CS401_A.csv` as bilal.raza; Admin ->
Interventions -> BU-144766 -> Dr. Ayesha Khan -> **Close assignment**; in the chat panel **Clear chat**. (Rows stay
tagged "live" and the notifications stay until the next reset.) **Block 6 has no manual undo:** a semester close can't
be undone from the app - only `npm run demo:reset` restores it.

## If something fails during the demo

| Failure | What you see | What to do |
|---|---|---|
| **ML service stopped or crashed** | Badges say **"Rule estimate - ML service offline"**; a re-prediction shows the rule label | Say: "This is the safety net: if the model is unreachable, the institutional rules keep the system working, and every screen says so." Restart it in its window (`.venv\Scripts\python -m uvicorn app:app --port 8001`) or run `start.cmd` again; Model page shows "ML service online" again. Stored predictions (all from the model) are unaffected. |
| **Gemini slow / quota (429) / overloaded (503)** | Free-form chat questions get "Sorry, I can't answer that one" | Nothing to fix - the demo only uses Layer 1 questions (2.4-2.6), which never call Gemini. Gemini is a bonus; mention it only if it answers. |
| **No Wi-Fi / no internet** | Tutorial links and Gemini don't open | Everything else is local (database, model, app). Skip clicking **Open tutorial**; say where it would go. |
| **A step gives a different number** | e.g. no label change in 3.3 | The data wasn't reset after a rehearsal: run `npm run demo:reset -- --yes` (or use the manual undo above). |
| **Port in use / app won't start** | `start.cmd` shows NOT RESPONDING | Close old SmartEdu windows, run `start.cmd` again (README troubleshooting). |
| **"Fall 2026 has already been closed"** (or "nothing to close") | Block 6.3 preview shows the warning; Close is disabled | The data wasn't reset after a rehearsal: run `npm run demo:reset -- --yes` (about 3 minutes). A new term name does not help: the closed term's classes are finished, so another close has nothing to close. If there is no time, skip 6.3-6.4 and show the screenshots in `docs/screenshots/phase7_demo/`. |
| **No "Awaiting attendance" row in 6.2** | Zain Khan's yesterday session is missing or already Present | The reset was made on an earlier day (dates count from the reset) or after a rehearsal: reset again today. Fallback: show **History** and an Upcoming row ("opens at ...") instead. |
| **Schedule session says the time clashes** | 409 "... already has a counselling session ..." | A rehearsal booked that slot: pick another time (that is the overlap check working - say so). |
| **Laptop or projector failure** | - | Play the recorded run: `docs/demo_recording/` (see its README.md; it predates block 6), then show the block 6 screenshots in `docs/screenshots/phase7_demo/`. |
