# Report evidence (copy from here)

Every number on this page comes from a command run on 2026-11-08 (Phase 6, step 5) on the demo
database built by `cd backend; npm run demo:reset` (50,000 synthetic students + 30 SYNTHETIC live-cohort
students). The command is given with each block so anyone can re-run it.

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
| Backend API + unit (Jest + Supertest) | `cd backend; npm run test:coverage` | **453 / 453 passed** in 22 suites |
| - of which role-based access matrix | `tests/rbac.test.js` | 234 (every route of every group: no token 401, wrong role 403, own role 2xx) |
| Backend coverage (`backend/src`, CLI scripts excluded) | same | **lines 88.4%**, statements 84.9%, functions 82.5%, branches 67.9% |
| ML service contract (pytest) | `cd ml_service; .venv\Scripts\python -m pytest tests` | **29 / 29 passed** |
| Chat assistant evaluation | `cd backend; node ../evaluation/chat_eval.js` | **363 / 363** questions (52 phrasings x 6 demo students incl. Roman Urdu, a counselor pass, 27 live-student questions) |
| Manual test cases (FR1-FR15 + portals) | `node ../evaluation/test_cases.js` -> `docs/TEST_CASES.md` | **51 / 51 passed**, executed through the API and a real browser |
| Demo actions (perform + revert) | `node ../evaluation/demo_actions_check.js` | 29 / 29 |
| Reproducible demo data | `npm run demo:reset` twice | identical per-table fingerprints (every reset in Phase 6) |

Coverage note: the command-line scripts (`demo:reset`, seeders, migrate) are excluded from the percentage; they are
verified by running them (the reset prints its own summary and fingerprint). The chatbot templates show 70% line
coverage under Jest; the 363-question chat evaluation exercises them separately.

## 6. Performance at 50,000 students

Command: `cd backend; node ../evaluation/perf_check.js` (10 runs each, one machine, HTTP on localhost; full table in `docs/PERFORMANCE.md`)

| Operation | Median | p90 |
|---|---|---|
| Login | 303 ms | 354 ms |
| Student dashboard | 15 ms | 45 ms |
| Admin dashboard | 152 ms | 201 ms |
| At-risk list, page 1 | 551 ms | 623 ms |
| At-risk list, filtered | 207 ms | 296 ms |
| Single-student refresh | 80 ms | 103 ms |
| One ML prediction (model + SHAP) | 58 ms | 75 ms |
| Chat answer (Layer 1) | 27 ms | 35 ms |
| Full batch prediction, 50,030 students | **92.8 s** | 119.1 s |

Against the SRS: NFR1.1 (100k records < 5 min) met by extrapolation (~3.1 min per 100k); NFR1.2 (one prediction
< 100 ms) met by the model call; NFR1.3 (dashboard < 3 s) met. Not measured: concurrent users (NFR4.2).

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
`<name>-390.png`). They are regenerated after the Phase 6 changes in step 8 (portal screens, new demo names).

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

## 9. Known limitations

- **Synthetic, policy-labelled data.** The 50,000 rows are synthetic and their labels follow an institutional rule set
  (`config/policy.json`; model and policy agree on 99.91%, section 2), so the near-perfect F1 shows the model learned
  that policy, not real dropout.
- **No real-world validation.** The live-cohort run is synthetic and probably uses training rows (section 4).
- **One semester per student.** The dataset has one row per student, so "history" is a single term plus predictions
  made inside the app.
- **Course-level data are seeded.** Only 40 students have course marks and attendance (derived from their CGPA by the
  seed); the other 50,000 rely on their imported term aggregates.
- **Chat Layer 2 (Gemini) optional.** The demo runs on Layer 1 templates; the free Gemini tier may use prompts for
  training, so only synthetic data may be sent, and it rate-limits (429) quickly.
- **Single-machine measurements.** Performance was measured with one user at a time on one PC; no load or concurrency
  test, no HTTPS in the local setup (NFR3.2 encryption is a deployment concern).
- **SRS items not implemented in the app:** training and comparing several models (FR2.1-2.2: the app serves one
  pre-trained Random Forest), PDF reports (FR3.2; CSV export only), SMOTE (FR2.5) and incremental learning (NFR4.3).
