# Report evidence (copy from here)

Every number on this page comes from a command run on 2026-11-08/09 on the demo database built by
`cd backend; npm run demo:reset` (50,000 synthetic students + 30 SYNTHETIC live-cohort students): first in Phase 6,
step 5, then re-run in full after the bug-fix pass (branch `bugfix/test-pass-2026-11`, ML service from
`ml_service/.venv`, scikit-learn 1.9.0). Sections 1-4 were unchanged by the re-run; sections 5 and 6 were updated.
Phase 7 (counselling sessions and academic probation, 2026-11-09) updated section 5, added section 5a and the Phase 7
figures and limitation; sections 1-4 and 6 are unchanged (the model, its features and the ML service did not change).
The command is given with each block so anyone can re-run it.

## 1. The model (from the `.pkl` metadata)

Command: `ml_service\.venv\Scripts\python evaluation/report_numbers.py`

| Item | Value |
|---|---|
| Model | SmartEdu Random Forest Version A, v1.0 (`RandomForestClassifier`, scikit-learn 1.9.0) |
| Hyper-parameters | 300 trees, max depth 16, min samples split 5, min samples leaf 4, max features 0.7 |
| Inputs / classes | 20 features; At-Risk, Dropout-Likely, Safe |
| Cross-validation macro F1 | **0.9992** (0.99923) |
| Test macro F1 | **0.9994** (0.99942) |
| Test accuracy | **0.9996** |
| Dataset type | "Synthetic policy-labelled student dataset" |
| Model file SHA-256 | `02f32a0ac5844dfd0957e8a78c7595b6b31de6eff256e34d26868137c5677177` |

## 2. Predictions in the system: source, model vs policy

Command: `evaluation/report_numbers.py` (reads every student's latest prediction)

| Item | Value |
|---|---|
| Latest labels (50,030 students) | Safe 23,331 · At-Risk 7,566 · Dropout-Likely 19,133 |
| Source of the latest predictions | **100% Random Forest** (50,030 model, 0 rule fallback) |
| Model label = policy label | **49,987 / 50,030 = 99.91%** |
| Disagreements | 43, all "model At-Risk, policy Safe" (the model is stricter; the policy never lowers it) |
| Labels raised by the policy | 0 |
| Final label = dataset label (synthetic students) | 49,980 / 50,000 = 99.96% - these rows were mostly seen in training, so this is a consistency check, not accuracy |

## 3. What the model relies on (global importance)

Command: `evaluation/report_numbers.py` (`GET /model-info`: mean |SHAP| per raw feature on a fixed 2,000-row sample, `random_state` 42)

| Feature | Share |
|---|---|
| CGPA | 44.0% |
| Previous SGPA | 25.8% |
| Attendance % | 21.3% |
| SGPA | 4.9% |
| Assignment submission rate | 1.8% |
| Failed courses | 1.4% |
| Assignment average | 0.6% |
| (all others) | < 0.2% each |

## 4. Live-cohort evaluation (Objective 7) - with its honest limits

Command: `python evaluation/live_eval.py` (writes `docs/live_eval.md`, `docs/live_eval_confusion.png`)

| Item | Value |
|---|---|
| Students | 30 (10 per label), all scored by the model, 0 fallback |
| Accuracy / macro F1 vs the recorded outcome | 1.000 / 1.000 |
| Model vs policy | 30 / 30 agree, 0 escalated |

Limits, to state in the report: the cohort is **SYNTHETIC** (`evaluation/sample_live_cohort.csv`, roll numbers `SYN-*`), a
random stratified sample of the same dataset; no train/test split record exists, so these rows were **probably in the
training data**. The run tests the pipeline end to end (import -> features with imputed missing values -> model ->
policy -> dashboards), not real-world accuracy. Labels in the dataset are policy-derived, not observed dropouts.

## 5. Tests

| Suite | Command | Result |
|---|---|---|
| Backend API + unit (Jest + Supertest) | `cd backend; npm run test:coverage` | **642 / 642 passed** in 28 suites (505 / 23 before Phase 7) |
| - of which role-based access | `tests/rbac.test.js` | 308: the route matrix over every route of every group (no token 401, wrong role 403, own role 2xx), now including the 19 Phase 7 routes, + 5 notification-ownership checks |
| - of which Phase 7 | `counsellingSessions`, `counsellingNotifications`, `academicStanding`, `semesterClose`, `standingScreens` | 67 (every scheduling rule, notifications, each handbook rule, the all-or-nothing close via a failing database trigger, letters, the enrolment hold) |
| - of which bug-fix regressions | `tests/bugfixes.test.js` | 45 (one block per bug of the 2026-11 test pass, plus "a database error never reaches the client") |
| Backend coverage (`backend/src`, CLI scripts excluded) | same | **lines 88.5%**, statements 85.6%, functions 84.1%, branches 71.8% (before Phase 7: lines 89.1%) |
| ML service contract (pytest) | `cd ml_service; .venv\Scripts\python -m pytest tests` | **29 / 29 passed** |
| Chat assistant evaluation | `cd backend; node ../evaluation/chat_eval.js` | **471 / 471** questions (69 phrasings x 6 demo students incl. Roman Urdu - counselling, probation status and rules added in Phase 7 -, a counselor pass, a booked-session pass, 27 live-student questions) |
| Manual test cases (FR1-FR17 + portals) | `node ../evaluation/test_cases.js` -> `docs/TEST_CASES.md` | **66 / 66 passed** on 2026-11-09 (15 new for FR16 counselling sessions and FR17 academic probation), executed through the API and a real browser |
| Demo actions (perform + revert) | `node ../evaluation/demo_actions_check.js` | 29 / 29 (re-run after Phase 7) |
| Phase 7 demo actions (real browser) | `node ../evaluation/phase7_demo_check.mjs` | **17 / 17** (schedule -> mark Present -> close semester -> Probation 1 -> schedule counselling -> acknowledge letter) |
| Reproducible demo data | `npm run demo:reset` twice | identical per-table fingerprints (every reset in Phase 6, and every reset of the bug-fix pass; class dates count back from the day of the reset, so compare resets made on the same day or pass `--as-of`) |

Coverage note: the command-line scripts (`demo:reset`, seeders, migrate) are excluded from the percentage; they are
verified by running them (the reset prints its own summary and fingerprint). The chatbot templates show 58% line
coverage under Jest (the Phase 7 intents are exercised by the chat evaluation, not Jest); the 471-question chat
evaluation exercises them separately. `academicStanding.js` shows 56%: its seeding function runs only inside
`demo:reset`; the pure handbook rules in it are fully unit-tested. The new counselling and close services are at
94-100% of lines.

## 5a. Academic standing and counselling (Phase 7)

Command: `cd backend; npm run demo:reset -- --yes` (prints the counts and the fingerprint), run twice on 2026-11-09.

| Item | Value |
|---|---|
| Rules | BU Student Handbook (Spring 2024) clause 5.5, in `backend/src/config/academicStanding.json` only: minimum CGPA BS/BBA/BEE/AD 2.0, MBA/MS/MPhil 2.5, PhD 3.0; 2 probations before drop; first semester judged on GPA; Probation 2 needs the Principal's approval to enrol |
| Starting standing after `demo:reset` (50,030 students) | **Good 26,466 · Probation 1 873 · Probation 2 16,508 · Dropped 0 · Not evaluated 6,183** (current semester 1) |
| Deterministic | two resets on the same day: identical fingerprint for every table (`academic_standing` md5 `131503e66874e2fc94520be34f081746`; all tables `b0d9bc173c159507b0ee4f5fdb9e0afd`) |
| Close-semester preview on the demo data ("Fall 2026") | 70 students enrolled this term: 38 good, 4 Probation 1, 5 Probation 2, 23 dropped; 9 warning letters |
| Demo counselling data | 3 counsellor assignments (Dr. Ayesha Khan), 10 sessions (Present / Absent history, one awaiting attendance, two upcoming) |
| Probation and the ML label | Standing is not a model input (the model still has its 20 features); the screens show "Risk prediction (Random Forest)" and "Academic standing (BU rules)" separately |

## 6. Performance at 50,000 students

Command: `cd backend; node ../evaluation/perf_check.js` (10 runs each, one machine, HTTP on localhost; full table in `docs/PERFORMANCE.md`)

| Operation | Median | p90 |
|---|---|---|
| Login | 269 ms | 443 ms |
| Student dashboard | 17 ms | 23 ms |
| Admin dashboard | 135 ms | 143 ms |
| At-risk list, page 1 | 277 ms | 353 ms |
| At-risk list, filtered | 199 ms | 203 ms |
| Single-student refresh | 61 ms | 72 ms |
| One ML prediction (model + SHAP) | 41 ms | 49 ms |
| Chat answer (Layer 1) | 16 ms | 21 ms |
| Full batch prediction, 50,030 students | **101.5 s** | 106.8 s |

All 10 batch runs scored every student through the Random Forest (0 fallback). Against the SRS: NFR1.1 (100k records
< 5 min) met by extrapolation (~3.4 min per 100k); NFR1.2 (one prediction < 100 ms) met by the model call; NFR1.3
(dashboard < 3 s) met. Not measured: concurrent users (NFR4.2).

## 7. ML audit statement

Checked again in Phase 6 (`grep -rn "INSERT INTO predictions\|target_label" backend/src`, plus section 2 above):

> Every stored label comes from the trained Random Forest. The only code that writes predictions is
> `predictionService.insertRows`. `model_label` is the ML service's argmax of `predict_proba`; the rule-based fallback is
> used only if the ML service cannot be reached, and its rows are marked `source = 'fallback'` (there are none in the demo
> database: 50,030 of 50,030 latest predictions are from the model). The institutional policy can only raise a label,
> never lower it (`final_label` = the more severe of model and policy; it raised 0 labels). No code path reads the
> dataset's `target_label` to set a label: it is only stored by the importer and read by the demo-data consistency
> summary. The what-if simulator uses the same scorer and saves nothing.

## 8. Screenshots, by figure

Produced by `cd frontend; npm run screenshots` into `docs/screenshots/` at 1280 px and 390 px (`<name>-1280.png`,
`<name>-390.png`). All 126 were regenerated on 2026-11-09 (Phase 7, step 8) after a fresh `npm run demo:reset`, so the
names match docs/DEMO_ACCOUNTS.md; the script reported no sideways scrolling and no page errors.

| Figure | Screen | File (`docs/screenshots/`) |
|---|---|---|
| 1 | Portal chooser | `portals` |
| 2 | Student / Faculty / Admin sign in | `login-student`, `login-faculty`, `login-admin` |
| 3 | Admin overview (KPIs, charts, run predictions, data sources) | `admin-overview`, `admin-data-sources` |
| 4 | Model page (model card, importance, model vs policy) | `admin-model` |
| 5 | Interventions (flagged list) + assign counselor + send | `admin-interventions`, `admin-assign-modal`, `admin-send-intervention` |
| 6 | Student dashboard, one per label | `student-BU-100040-dashboard` (Safe), `student-BU-112907-dashboard` (At-Risk), `student-BU-144766-dashboard` (Dropout-Likely) |
| 7 | "What to do next" (counselor, tutorial, steps) | `student-BU-115624-what-next` |
| 8 | Ask SmartEdu chat, one per label | `student-BU-100040-chat`, `student-BU-112907-chat`, `student-BU-144766-chat` |
| 9 | Faculty classes and roster | `faculty-ayesha-classes`, `faculty-ayesha-roster` |
| 10 | What-if simulator (faculty, admin) | `faculty-whatif`, `admin-whatif` |
| 11 | Bulk upload: tab, preview with errors, result | `faculty-upload`, `faculty-upload-preview`, `faculty-upload-result` |
| 12 | My counselees + drawer | `faculty-zain-counselees`, `faculty-zain-counselee-drawer` |
| 13 | Live cohort import | `admin-live-cohort` |
| 14 | Users, tutorials, audit log, assignments | `admin-users`, `admin-tutorials`, `admin-audit-log`, `admin-assignments` |
| 15 | Forced and voluntary password change | `change-password-forced`, `change-password` |
| 16 | Counselling: admin page, faculty sessions, student page (Phase 7) | `admin-counselling`, `faculty-ayesha-counselling`, `student-BU-122785-counselling` |
| 17 | Academic standing: admin page (close semester, probation list), student card | `admin-academic-standing`, `student-BU-144766-dashboard` (Probation 2 card with the enrolment hold) |
| 18 | Phase 7 demo actions, step by step | `phase7_demo/` (`1_admin_booked` ... `5_student_letter`) |

## 9. Known limitations

- **Synthetic, policy-labelled data.** The 50,000 rows are synthetic and their labels follow an institutional rule set
  (`config/policy.json`; model and policy agree on 99.91%, section 2), so the near-perfect F1 shows the model learned
  that policy, not real dropout.
- **No real-world validation.** The live-cohort run is synthetic and probably uses training rows (section 4).
- **One semester per student.** The dataset has one row per student, so "history" is a single term plus predictions
  made inside the app.
- **Starting probation status is seeded, not observed.** Because each student has only one completed term, the
  starting academic standing comes from the current CGPA and the dataset's consecutive-low-CGPA flag, and that flag is
  defined on the *previous SGPA* (CGPA < 2.0 and Previous_SGPA < 2.0), not on two consecutive end-of-term CGPAs as the
  handbook means. This is why so many students (16,508) start on Probation 2. Real standing builds up from semester
  closes made in the app; the end-of-term CGPA there is the projected CGPA from this term's marks
  ((Previous_SGPA + SGPA) / 2, SGPA from the fitted mark formula), not an official transcript calculation.
- **Probation rules are configured, not per programme in the data.** Students have no programme field; the programme
  (and so the minimum CGPA) comes from the department mapping in `academicStanding.json` (all current departments are
  undergraduate, minimum 2.00). No HoD or Principal accounts exist: the admin records the approver role.
- **Course-level data are seeded.** Only 40 students have course marks and attendance (derived from their CGPA by the
  seed); the other 50,000 rely on their imported term aggregates.
- **Chat Layer 2 (Gemini) optional.** The demo runs on Layer 1 templates; the free Gemini tier may use prompts for
  training, so only synthetic data may be sent, and it rate-limits (429) quickly.
- **Single-machine measurements.** Performance was measured with one user at a time on one PC; no load or concurrency
  test, no HTTPS in the local setup (NFR3.2 encryption is a deployment concern).
- **SRS items not implemented in the app:** training and comparing several models (FR2.1-2.2: the app serves one
  pre-trained Random Forest), PDF reports (FR3.2; CSV export only), SMOTE (FR2.5) and incremental learning (NFR4.3).
