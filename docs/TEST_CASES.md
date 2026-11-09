# Manual test cases

Every case below was executed on 2026-11-09 through the running system - the API over HTTP, and the portal/UI cases in a
real browser (Playwright, Chromium) - by `evaluation/test_cases.js`, right after `npm run demo:reset` (the script changes
demo data; reset again afterwards). The Steps column says what a person does in the UI; the script performs the same
action through the same API the UI calls.

**Result: 72 / 72 passed.**

## Functional requirements

The SRS (*Software Requirements Specification 1.docx*) groups requirements as FR1-FR4 with sub-items; the code and
earlier phases refer to FR11-FR13. This consolidated list FR1-FR15 keeps those numbers and maps each one to the SRS;
FR16-FR17 were added in Phase 7 (approved by the project owner and supervisor).

| FR | Requirement | SRS reference | Cases |
|---|---|---|---|
| P | Separate sign-in portals (Phase 6) | NFR3.1 | 6 |
| FR1 | Authentication, roles and session security | NFR3.1 | 4 |
| FR2 | User management (create, deactivate, reset password) and audit log | NFR3.1, NFR3.3 | 3 |
| FR3 | Courses, faculty assignment, enrollment and drop | - | 1 |
| FR4 | Data import: 50k dataset and live cohort (validation, missing values) | FR1.1, FR1.2 | 3 |
| FR5 | Faculty results entry with server-derived grades and live re-prediction | FR2.3 | 3 |
| FR6 | Faculty attendance marking | - | 2 |
| FR7 | Risk prediction: Random Forest, single and batch, policy escalation, fallback | FR2.3, FR2.4 | 3 |
| FR8 | Explanations: reasons, model transparency page, what-if | FR3.4, FR4.1 | 3 |
| FR9 | Student dashboard, results, attendance and history | FR1.4, FR3.1 | 3 |
| FR10 | Faculty class risk view | FR3.1, FR3.4 | 2 |
| FR11 | Study material recommendations (tutorials) | FR4.1 | 3 |
| FR12 | Counselor assignment and follow-up | FR4.1, FR4.2 | 3 |
| FR13 | Bulk CSV uploads of marks and attendance | FR1.1 | 3 |
| FR14 | Admin dashboard, flagged list, interventions and export | FR3.1, FR3.3, FR4.3 | 4 |
| FR15 | "Ask SmartEdu" chat assistant | FR4.1 | 5 |
| FR16 | Counselling sessions: scheduling, reschedule/cancel, attendance, notifications (Phase 7) | FR4.2 | 7 |
| FR17 | Academic probation under the BU Student Handbook 5.5: standing, semester close, letters, enrolment hold (Phase 7) | FR4.2, FR4.3 | 8 |
| FIX | Phase 7.1 bug fixes: the close ends the term, final semester, orphaned counselling sessions, seeded status | FR4.2, FR4.3 | 6 |

## Cases

| ID | Description | Steps | Expected | Result |
|---|---|---|---|---|
| TC-P-01 | Portal chooser | Open http://localhost:5173/ | Three portals (Student, Faculty, Admin), each with a Sign in link; SmartEdu branding | Pass (2026-11-09) |
| TC-P-02 | Each role signs in through its own portal | Sign in as admin, ayesha.khan and student100040 on their own portal | Each lands on its dashboard (/admin, /faculty, /student) | Pass (2026-11-09) |
| TC-P-03 | Wrong-portal sign-in | On Faculty sign in, enter student100040@smartedu.edu / Student@123 | "This is a student account - please use the Student sign in" with a button to the Student portal; no session stored | Pass (2026-11-09) |
| TC-P-04 | Wrong password reveals nothing | POST /api/auth/login with a wrong password (and an unknown email) on each portal | The same 401 'Invalid email or password' every time | Pass (2026-11-09) |
| TC-P-05 | Signed-out deep link | Signed out, open /faculty/counselees | Redirected to /login/faculty | Pass (2026-11-09) |
| TC-P-06 | Logout returns to the user's own portal (phone width) | At 390px sign in as ayesha.khan, open the menu, Log out | Back on /login/faculty | Pass (2026-11-09) |
| TC-FR1-01 | Role-based access on the server | Call a student, a faculty and an admin endpoint with each other role's token, and with no token | 403 for another role, 401 with no token | Pass (2026-11-09) |
| TC-FR1-02 | Deactivated account is signed out at once | Sign in a test account; admin deactivates it; use the old token | 401 ACCOUNT_DISABLED; signing in again is refused | Pass (2026-11-09) |
| TC-FR1-03 | Temporary password must be changed first | Sign in with a must-reset account; call any other API; change the password | 403 PASSWORD_RESET_REQUIRED until changed; afterwards normal access with a fresh token | Pass (2026-11-09) |
| TC-FR1-04 | Password rules enforced | Change password to 'short', 'alllowercase1', 'NoDigitsHere' | 400 each time with the failed rules listed | Pass (2026-11-09) |
| TC-FR2-01 | Admin creates a student account | Users -> Create student account (email, name, roll no, department) | 201 with a temporary password; the account must set its own password at first sign-in | Pass (2026-11-09) |
| TC-FR2-02 | Admin resets a password (one-time box) | Users -> Reset password on a student -> confirm -> copy the temporary password | Box shows a 12-character password once; the student signs in with it and must change it; old sessions end | Pass (2026-11-09) |
| TC-FR2-03 | Every admin action is in the audit log | Audit log page after the steps above | Entries for CREATE/RESET/DEACTIVATE with actor, entity and details (never a password) | Pass (2026-11-09) |
| TC-FR3-01 | Course, teacher assignment, enrollment and drop | Assignments: create course TC###, assign Dr. Amina Sheikh section T, enroll BU-100040, then drop | Each step succeeds; duplicates are refused (409); the dropped student leaves the roster | Pass (2026-11-09) |
| TC-FR4-01 | 50,000-row dataset loaded | Count students and performance rows after demo:reset | 50,000 synthetic students, each with one performance row and a dataset label | Pass (2026-11-09) |
| TC-FR4-02 | Live cohort preview validates rows and writes nothing | Admin -> Import a live cohort -> preview a file with 1 good row and 2 bad rows (unknown department, existing roll no) | Preview lists 2 errors with row and column; no student is created | Pass (2026-11-09) |
| TC-FR4-03 | Imported live students are scored with missing inputs imputed | After demo:reset, check the 30 SYN-* students' latest predictions | 30 predictions, all from the Random Forest model (missing features imputed, none from the rule fallback) | Pass (2026-11-09) |
| TC-FR5-01 | Faculty saves marks; label updates live | ayesha.khan -> AI301 A -> BU-112907: Quiz 75, Midterm 88 -> Save | Grade C -> B (server-derived), toast 'At-Risk -> Safe'; the student's dashboard shows Safe | Pass (2026-11-09) |
| TC-FR5-02 | Faculty can't edit another teacher's class | As ayesha.khan, PUT marks for an enrollment in bilal.raza's CS401 A | 403; marks unchanged | Pass (2026-11-09) |
| TC-FR5-03 | Marks outside 0-100 are rejected | Save a quiz mark of 105 | 400 with the field named | Pass (2026-11-09) |
| TC-FR6-01 | Faculty marks attendance for a session | ayesha.khan -> AI301 A -> Mark attendance for 2026-01-05, all present | Saved for every student, tagged live; students re-predicted | Pass (2026-11-09) |
| TC-FR6-02 | Attendance for a student outside the class is refused | Mark attendance in AI301 A including an enrollment from CS401 A | 403 and nothing written | Pass (2026-11-09) |
| TC-FR7-01 | A student's prediction comes from the Random Forest | Student refreshes their prediction | source 'model', model version of the .pkl, label one of Safe/At-Risk/Dropout-Likely | Pass (2026-11-09) |
| TC-FR7-02 | Batch prediction run for a department | Admin -> Overview -> Run predictions -> Department: Artificial Intelligence -> Start | Run completes; every student in the department predicted by the model (0 fallback) | Pass (2026-11-09) |
| TC-FR7-03 | The policy only escalates the model's label | Compare model_label and final_label over every student's latest prediction | final_label is never less severe than model_label | Pass (2026-11-09) |
| TC-FR8-01 | Student sees plain-language reasons, never probabilities | Student dashboard (BU-144766) | 1-3 reasons with the student's own numbers; no probabilities, SHAP values or raw features in the response | Pass (2026-11-09) |
| TC-FR8-02 | Model page proves the Random Forest | Admin -> Model | RandomForestClassifier, 300 trees, 20 features, CV/test macro F1 0.9992/0.9994, global importance (CGPA first) | Pass (2026-11-09) |
| TC-FR8-03 | What-if simulator (nothing saved) | ayesha.khan -> BU-100040 -> What if? -> Attendance 55% | Safe -> Dropout-Likely from the model; attendance tops the drivers; no prediction stored | Pass (2026-11-09) |
| TC-FR9-01 | Student dashboard renders | Sign in as student144766 and open the dashboard | Status hero (High risk), reasons, 'Random Forest model' badge, CGPA tiles, What to do next, charts; no page errors | Pass (2026-11-09) |
| TC-FR9-02 | Results and attendance pages show the student's own courses | Student -> Results, Attendance | 4 AI courses with marks and derived grades; attendance per course | Pass (2026-11-09) |
| TC-FR9-03 | Prediction history is kept | Student status timeline / history after the refresh in TC-FR7-01 | History holds every prediction; timeline has one point per day | Pass (2026-11-09) |
| TC-FR10-01 | Faculty sees risk in their classes | ayesha.khan -> My classes -> AI301 A roster | Only her classes; label counts; roster with label, reasons and the model badge source; no probabilities | Pass (2026-11-09) |
| TC-FR10-02 | Class risk summary | AI301 A -> Risk in this class | Counts per label (sum = 8), A-F grade distribution, attendance per session | Pass (2026-11-09) |
| TC-FR11-01 | Every course has active study material | Admin -> Tutorials | Each of the 20 courses has at least one active tutorial | Pass (2026-11-09) |
| TC-FR11-02 | A flagged student gets material for their weakest course | Student BU-144766 -> What to do next | Tutorial card for AI302 (average 53) with an external link | Pass (2026-11-09) |
| TC-FR11-03 | Admin adds and deactivates a tutorial | Tutorials -> Add (course AI302) -> Deactivate | 201 then the tutorial is inactive; both in the audit log | Pass (2026-11-09) |
| TC-FR12-01 | Admin assigns a counselor | Interventions -> BU-144766 -> Assign -> Dr. Ayesha Khan | Assigned; the student and the counselor are both notified; the student's dashboard shows the counselor | Pass (2026-11-09) |
| TC-FR12-02 | Counselor follows up; others can't | ayesha.khan -> My counselees -> Farah Javed -> notes, Mark contacted today; bilal.raza opens the same counselee | Notes and contact date saved; bilal.raza gets 403 | Pass (2026-11-09) |
| TC-FR12-03 | Closing an assignment | Interventions -> Dr. Ayesha Khan -> Close assignment | Closed; the row shows Assign again; the counselor no longer lists the student | Pass (2026-11-09) |
| TC-FR13-01 | Upload template prefilled with the roster | bilal.raza -> CS401 A -> Upload -> Download marks template | CSV with roll_no, name and empty mark columns, one row per enrolled student | Pass (2026-11-09) |
| TC-FR13-02 | Preview catches bad rows and saves nothing | Upload docs/demo_files/demo_marks_upload_CS401_A.csv in preview | 9 rows: 7 valid, 2 errors (quiz '8O' on row 4, BU-100099 not in the class on row 10); nothing written | Pass (2026-11-09) |
| TC-FR13-03 | Commit saves good rows and re-predicts; undo file reverts | Save 7 valid rows; then upload demo_marks_undo_CS401_A.csv | 7 saved, 2 rejected, 1 label changed (BU-145871 Safe -> At-Risk); after the undo file BU-145871 is Safe again | Pass (2026-11-09) |
| TC-FR14-01 | Admin dashboard KPIs and charts | Admin -> Overview | Students 50,030; label counts add up to the predicted total; charts and data sources render without errors | Pass (2026-11-09) |
| TC-FR14-02 | Flagged list with filters | Interventions -> Label: Dropout-Likely, Department: AI, search BU-1 | Only matching flagged students, sorted by severity, 25 per page | Pass (2026-11-09) |
| TC-FR14-03 | Intervention message with tutorial | Select BU-112907 -> Send -> keep the template and 'Add tutorial' | Sent; the student's bell shows it with their own name and the tutorial line | Pass (2026-11-09) |
| TC-FR14-04 | Export the flagged list as CSV | Interventions -> Export CSV | UTF-8 CSV (BOM) with the documented columns; formula-safe cells | Pass (2026-11-09) |
| TC-FR15-01 | Why is my status this? | Student BU-144766 -> Ask SmartEdu -> 'Why is my status this?' | Label in supportive wording, the reasons with real numbers, a 'this is a warning, not a final result' line (wording varies); from the templates (no LLM needed) | Pass (2026-11-09) |
| TC-FR15-02 | Roman Urdu question | 'meri attendance kaisi hai?' | Attendance answer with the student's real figures (62.5%, 20 of 32 after a reset), per course, sessions needed to reach 75% | Pass (2026-11-09) |
| TC-FR15-03 | Questions about another student are refused | 'What is BU-122785's CGPA?' | Fixed refusal; no numbers about that student; never confirms they exist | Pass (2026-11-09) |
| TC-FR15-04 | Wellbeing message gets support contacts | 'I'm so stressed about my exams' | Supportive reply with the support office contacts | Pass (2026-11-09) |
| TC-FR15-05 | Live-cohort student's marks (imported) | Reset SYN-101155's password, sign in, ask 'What are my marks?' | Their CS301 imported average (89) and that the marks come from the imported record - not 'no marks yet' | Pass (2026-11-09) |
| TC-FR16-01 | Admin schedules a counselling session; both are notified | Admin -> Counselling -> Schedule session -> BU-122785 (counsellor fills in as Dr. Ayesha Khan) -> tomorrow 10:00, Room 204 | 201; the session shows Upcoming; the student and Dr. Khan each get 'Counselling session with ... on <date>, 10:00 AM (30 min), Room 204' | Pass (2026-11-09) |
| TC-FR16-02 | Clashing or past times are refused | Book Dr. Khan for BU-112907 at the same time; book any session in the past | 409 'Dr. Ayesha Khan already has a counselling session on ...'; 400 'must be in the future'; nothing saved | Pass (2026-11-09) |
| TC-FR16-03 | Choosing a different counsellor needs confirmation | Schedule BU-122785 with Mr. Zain Abbas | 409: 'This makes Mr. Zain Abbas the counsellor instead of Dr. Ayesha Khan. Her N upcoming session(s) with Dr. Ayesha Khan will be cancelled.' (the form asks Continue?); the counsellor is unchanged | Pass (2026-11-09) |
| TC-FR16-04 | The counsellor marks yesterday's session Present | ayesha.khan -> Counselling -> Zain Khan, yesterday 2:00 PM, 'Awaiting attendance' -> Present -> note -> Save | Moves to History as Present; Zain Khan sees Present and 'Attended 3 of 3' and a notification; the private note is never sent to him | Pass (2026-11-09) |
| TC-FR16-05 | Only the session's counsellor marks, and only after it starts | zain.abbas marks the session from TC-FR16-01; ayesha.khan marks it before it starts | 403 for the other teacher; 409 'hasn't started yet' for the counsellor | Pass (2026-11-09) |
| TC-FR16-06 | Reschedule and cancel (with a reason) notify both | Admin -> Counselling -> Reschedule the TC-FR16-01 session to 11:30; then Cancel with reason 'Counsellor unavailable' | Both get 'has moved from ... to ...' and '... has been cancelled. Reason: Counsellor unavailable'; cancel without a reason is refused | Pass (2026-11-09) |
| TC-FR16-07 | Student counselling page and chat | BU-112907 -> Counselling; Ask SmartEdu 'meri counselling kab hai?' | Next session (in 3 days, 2:00 PM, online) and 'Attended 3 of 3'; the chat answers with that session | Pass (2026-11-09) |
| TC-FR17-01 | Starting standing after demo:reset | Admin -> Overview -> Academic standing tiles; Users -> Standing filter | Every student has a standing: semester 1 not evaluated; CGPA >= 2.00 good; below 2.00 Probation 1 (never 2 at the start - Phase 7.1); counts 26,466 / 17,381 / 0 / 6,183 | Pass (2026-11-09) |
| TC-FR17-02 | Close-semester preview writes nothing | Admin -> Standing -> Term 'Fall 2026' -> Preview | 70 students with their from -> to standing (after a fresh reset: 38 good, 4 Probation 1, 28 Probation 2, 0 dropped, 32 letters - nobody can be dropped at the first close); Bushra Awan (BU-114400) Good -> Probation 1 on CGPA 1.97; no rows written | Pass (2026-11-09) |
| TC-FR17-03 | Close refused until results are final (Handbook 1.20.4) | Close semester without ticking 'All results ... are final' | 400 RESULTS_NOT_FINAL quoting 1.20.4 (the button stays disabled in the UI) | Pass (2026-11-09) |
| TC-FR17-04 | Close the semester -> Probation 1, letter, notification | Admin -> Standing -> Fall 2026 -> tick 'results are final' -> Close Fall 2026 -> Close the semester | Toast 'Fall 2026 closed'; Bushra Awan is Probation 1 of 2 with a level-1 warning letter and the notice 'Academic standing: Probation 1 of 2'; her new official CGPA is 1.97; students re-predicted by a batch run | Pass (2026-11-09) |
| TC-FR17-05 | The student acknowledges their own letter only | Bushra Awan -> dashboard -> Academic standing (BU rules) -> I acknowledge this letter; BU-112907 tries to acknowledge it | Acknowledged with the time ('Acknowledged by the student on ...'); someone else's letter -> 404 | Pass (2026-11-09) |
| TC-FR17-06 | Enrolment hold on Probation 2; dropped can't enrol | Assignments -> enroll BU-144766 (Probation 2 after the Fall 2026 close) in CS401 A -> Record approval ('Principal via HoD') -> enroll again, then drop it; enroll a dropped student (dropped standing set up directly: nobody can be dropped at the first close) | 409 ENROLMENT_HOLD, then 201 after the approval; 409 STUDENT_DROPPED | Pass (2026-11-09) |
| TC-FR17-07 | Standing and the risk prediction are shown side by side, never mixed | Student dashboard (Bushra Awan); Admin -> Model | 'Risk prediction (Random Forest)' and 'Academic standing (BU rules)' are separate; the model still has exactly its 20 features (no standing input) | Pass (2026-11-09) |
| TC-FR17-08 | Chat answers probation questions from the student's own record | Bushra Awan asks 'Am I on probation?' and 'agar meri cgpa 2 se kam rahi to kya hoga?'; then 'Is Ali on probation?' | Probation 1 of 2 with her CGPA 1.97 and the 2.00 minimum; the handbook rules (drop after two probations); refusal for another student | Pass (2026-11-09) |
| TC-FIX-01 | Bug 1: the close ends the term - the closed term is not counted again | After Fall 2026 is closed: Bushra Awan's dashboard; Admin -> Overview | Every enrolment of the term is completed; Bushra's projected CGPA = official CGPA = 1.97; no 'two consecutive low terms' note; no student's risk label changed because of the close | Pass (2026-11-09) |
| TC-FIX-02 | Bug 1: a completed class takes no marks or attendance; a second close is refused | ayesha.khan -> AI301 A -> enter a mark / mark attendance for Bushra; Admin -> Standing -> Term 'Spring 2027' -> Preview / Close | 400 'This class was completed when the term was closed ...' for marks and attendance; preview 0 students; close 400 'nothing to close' | Pass (2026-11-09) |
| TC-FIX-03 | Bug 2: a final-semester student is not moved past semester 8 | After the close: BU-100040 Sana Raza (semester 8) | No student above semester 8; Sana stays in semester 8, her standing row says final semester completed; her new prediction comes from the model with Semester 8 | Pass (2026-11-09) |
| TC-FIX-04 | Bug 3: changing the counsellor cancels the old counsellor's upcoming sessions | Admin -> Counselling -> Schedule session for BU-122785 with Mr. Bilal Raza -> Continue | The form says how many sessions will be cancelled; afterwards no upcoming 'scheduled' session with Dr. Ayesha Khan remains (reason 'Counsellor changed to Mr. Bilal Raza'); both people notified | Pass (2026-11-09) |
| TC-FIX-05 | Bug 4: closing a counselling assignment cancels its upcoming sessions | Admin -> Interventions -> BU-112907 -> Dr. Ayesha Khan -> Close assignment (the dialog says how many sessions will be cancelled) | Close returns cancelled_sessions = the count shown; no upcoming 'scheduled' session remains for that assignment (reason 'Counselling assignment closed'); audit-logged | Pass (2026-11-09) |
| TC-FIX-06 | Bug 5: the seeded status can't drop anyone at the first close | demo:reset -> Admin -> Overview; Standing -> Fall 2026 close (TC-FR17-04) | No seeded Probation 2 or dropped rows; the Fall 2026 close dropped nobody (BU-144766 Farah Javed went Probation 1 -> Probation 2) | Pass (2026-11-09) |
