# SmartEdu — project memory

Final-year project: a student dropout-risk dashboard. Students, faculty and admin
log in to one React app; a Random Forest model predicts each student's risk
(`Safe` / `At-Risk` / `Dropout-Likely`).

## Architecture

```
React + Vite + Tailwind (frontend/, :5173)
   │  axios → /api  (Vite dev proxy → :5000)
   ▼
Node.js + Express API (backend/, :5000) ──► PostgreSQL (database `smartedu`, :5432)
   │  POST ML_SERVICE_URL (/predict) and /predict/batch, from services/predictionService.js
   ▼
FastAPI ML service (ml_service/, :8001) — loads smartedu_random_forest_version_a.pkl
```

- **Backend** (`backend/src/`)
  - `server.js` — helmet, CORS (`FRONTEND_ORIGIN`), morgan, login rate limit on
    `/api/auth/login` (`LOGIN_RATE_LIMIT_MAX`, default 20, per `LOGIN_RATE_LIMIT_WINDOW_MIN`
    minutes, default 15, per IP; 200 in the local `.env`), mounts the route files, and on start
    marks unfinished `prediction_runs` as failed (runs are processed in memory).
  - `config/db.js` — single `pg` Pool from `DATABASE_URL`.
  - `middleware/auth.js` — `authenticate` (JWT Bearer → `req.user = {userId, role, email}`)
    and `authorize(...roles)`. Role is enforced server-side on every router.
  - `middleware/audit.js` — `logAction()` writes to `audit_log`, never throws.
  - `middleware/validate.js` — turns express-validator errors into `400 {error, details}`.
  - `routes/*Routes.js` + `controllers/*Controller.js`, one pair per area:
    - `auth` — `POST /login` (returns token, role, profile), `POST /change-password`, `GET /me`
    - `student` — read-only: dashboard, results, attendance, history, prediction,
      `POST /prediction/refresh` (runs `predictForStudent`). Student responses include
      `final_label`, `reasons` and `policy_reason`, never `drivers` (SHAP numbers) or `features`.
    - `faculty` — own classes only (`assertOwnsClass`): roster, attendance, upsert results, mark
      attendance. Inputs validated with express-validator (marks 0-100, date, status enum). The server
      derives the grade (`services/grading.js`); a client-sent grade is ignored. Saves set
      `data_source='live'` and re-predict (see below).
    - `admin` — dashboard, user provisioning (temp passwords), directory, courses,
      faculty↔course assignment, enrollments, read-only class records, interventions/notifications,
      batch runs: `POST /predictions/run {scope: "all"|"department"|"class", scopeId}` → `202` with the
      `prediction_runs` row (one run at a time, else `409`); `GET /predictions/runs/:id` for progress.
      Dashboard and at-risk lists use each student's **latest** `final_label`;
      `/at-risk-students` and `/predictions` take `?limit` (default 500, max 5000).
    - `notifications` — any logged-in user, scoped to `recipient_user_id`
  - `scripts/createAdmin.js`, `scripts/hashPassword.js`, `scripts/migrate.js`.
  - `services/` — the prediction pipeline:
    - `featureBuilder.js` — `buildFeatures(id)` / `buildFeaturesMany(ids)` → `{features (20), sources, extra}`.
      Starts from the latest `student_semester_performance` row, then overrides from current-semester
      enrollments (`status='enrolled'`): Attendance_Percentage = present / total sessions;
      Assignment/Quiz/Midterm/Final = mean of course results; SGPA ("provisional") = credit-weighted
      `clamp(0.0640 × course mean mark − 2.453, 0, 4)`; CGPA ("projected") = (Previous_SGPA + SGPA) / 2.
      Formulas fitted by `evaluation/sgpa_cgpa_relationship.py`. Credits and Failed_Courses stay imported.
    - `policy.js` + `config/policy.json` — `applyPolicy(features, modelLabel)` →
      `{policyLabel, reason, finalLabel}`. Rules: CGPA < 2.00 and Previous_SGPA < 2.00 → Dropout-Likely;
      attendance < 60% → Dropout-Likely; CGPA < 2.30 → At-Risk; attendance < `min_attendance_pct` (75%)
      → At-Risk. final = more severe of model and policy (the policy only escalates). Thresholds from
      `evaluation/policy_tree.py` (the rule set matches 99.95% of dataset labels).
    - `reasons.js` — `toReasons(drivers, features)` → up to 3 student-friendly sentences, no SHAP numbers.
    - `predictionService.js` — `predictForStudent(id, {trigger})`, `predictForMany(ids, {runId, trigger})`:
      build features → ML `/predict` or `/predict/batch` (on failure `ruleBasedFallback`,
      `source='fallback'`, `drivers=null`) → policy → reasons → insert into `predictions`.
    - `predictionRuns.js` — admin runs in the background, 1000 students per chunk.
    - `grading.js` — grade from marks (equal weights; A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40), same as the seed.
  - **Re-prediction** happens on student refresh (`student_refresh`), after every faculty result save
    (`faculty_result`, that student), after every attendance save (`faculty_attendance`, the affected
    students via `predictForMany`) and in admin runs (`admin_run`); stored in `predictions.triggered_by`.
    Prediction errors are logged and never fail a save.
- **ML service** (`ml_service/app.py`) — loads a dict from the `.pkl`:
  `pipeline`, `feature_names` (20), `target_classes` (`['At-Risk','Dropout-Likely','Safe']`),
  metrics, `model_name`, `model_version`. `GET /health`, `POST /predict {features: {...}}`
  → `{label, prob_safe, prob_at_risk, prob_dropout, model_version, explanations, base_value}`;
  `POST /predict/batch {rows: [...]}` (max 2000) → `{results: [...]}` with the same per-row shape.
  `explanations` = top 5 raw features by |SHAP| for the predicted class (`shap.TreeExplainer` built
  once; one-hot columns summed back to their source feature):
  `{feature, value, shap, direction: "raises_risk"|"lowers_risk"}` (for a Safe prediction, pushing
  toward Safe lowers risk). `model.n_jobs` is set to 1 for inference (faster). Latency: ~67 ms median
  per single call, ~7-10 s per 2000-row batch (SHAP dominates).
  Tests: `cd ml_service; .venv\Scripts\python -m pip install -r requirements-dev.txt;
  .venv\Scripts\python -m pytest tests`.
  If the service is unreachable the backend uses `ruleBasedFallback()` (CGPA/warnings
  thresholds, `model_version = "rule_fallback"`, `source = 'fallback'`).
- **Database** (`database/`)
  - `schema.sql` — tables: users, departments (5 seeded), students, faculty, courses,
    faculty_courses, enrollments, course_results, attendance,
    student_semester_performance, predictions, notifications, audit_log.
  - `migrations/001_prediction_explain.sql` — predictions gain `model_label`, `policy_label`,
    `final_label` (`predicted_label` is kept and always equals it), `policy_reason`, `drivers`,
    `reasons`, `features`, `feature_sources`, `source`; `data_source` ('synthetic' | 'live') on
    course_results, attendance and student_semester_performance; the `prediction_runs` table; index
    `(student_id, created_at DESC, prediction_id DESC)` for latest-per-student queries.
    `002_prediction_trigger.sql` — `predictions.triggered_by` and `predictions.run_id`.
  - `import_dataset.py` — loads the 50k-row CSV: one user+student per `Student_ID`
    (email `student<ID>@smartedu.edu`, roll `BU-<ID>`) and one
    `student_semester_performance` row each (incl. the dataset's `target_label`).
  - `seed_demo_data.py` — 10 faculty, 20 courses, sections, and 8 random students per
    department enrolled in their department's section-A classes, with results and
    8 attendance sessions derived from their performance row.
  - `generate_student_names.py` — optional; replaces "Student 12345" with random names.
  - `demo_login_lookup.sql` — pgAdmin queries to list demo logins.

## Running each service (Windows, PowerShell)

PostgreSQL 17 runs as the Windows service `postgresql-x64-17`. `psql` is not on PATH:
`& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -d smartedu`.

```powershell
# ML service (port 8001) — one-time: python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
cd ml_service; .venv\Scripts\python -m uvicorn app:app --port 8001

# Backend (port 5000) — needs backend\.env (copy .env.example; never commit it)
cd backend; npm run dev

# Frontend (port 5173)
cd frontend; npm run dev
```

Fresh database setup: `createdb smartedu` → `psql -f database/schema.sql` →
`node backend/src/scripts/createAdmin.js "admin@smartedu.edu" "Admin@123"` →
`python database/import_dataset.py --csv SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv --dsn <DSN>` →
`python database/seed_demo_data.py --dsn <DSN>`.

Schema changes go in a new numbered file in `database/migrations/` (e.g. `001_add_x.sql`),
applied with `cd backend; npm run migrate` (`src/scripts/migrate.js`: filename order, one
transaction per file, recorded in `schema_migrations`, already-applied files skipped).

npm 11 blocks install scripts: `bcrypt` (backend) and `esbuild` (frontend) are allowed via
`allowScripts` in their `package.json`.

## Working rules

- Single developer, work directly on `main`. Do not create branches.
- One commit per step, conventional message (e.g. `fix(ml): pin scikit-learn`).
  Commit only after that step's check passes.
- Before each commit, smoke check: backend starts, ML `GET /health` responds, and
  `POST /api/auth/login` works for one student, one faculty and one admin account.
- If a check fails and can't be fixed, stop and report. Never commit a broken state.
- Never commit `.env` files or secrets.
- Read a file before changing it. Keep changes minimal and match the existing style.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@smartedu.edu` | `Admin@123` (set via `createAdmin.js`) |
| Faculty (all 10) | e.g. `amina.sheikh@smartedu.edu` | `Faculty@123` (`seed_demo_data.py`) |
| Students (all 50k) | `student<ID>@smartedu.edu` | `Student@123` (`import_dataset.py` default) |

The six curated demo students (2 per label, grades consistent with CGPA, label = model) and the
faculty login that shows them are in [docs/DEMO_ACCOUNTS.md](docs/DEMO_ACCOUNTS.md); they were
found with `database/find_consistent_demo_students.sql`. The same file has a repeatable
live re-prediction demo (one faculty save that moves BU-112907 from At-Risk to Safe).

## Known facts

- The model was pickled with **scikit-learn 1.9.0** (recorded in each estimator's
  `_sklearn_version`). Other versions warn or break (1.8.0: `ColumnTransformer has no
  attribute 'force_int_remainder_cols'`). Always run the ML service from
  `ml_service/.venv` with the pinned `requirements.txt`.

- Predictions use live data where it exists (see `featureBuilder.js`); the imported row fills the
  rest. `predictions.feature_sources` records every override.
- Dataset identities: Credits_Passed = Credits_Enrolled − 3 × Failed_Courses (100% of rows);
  Consecutive_Low_CGPA = (CGPA < 2.0 and Previous_SGPA < 2.0) (100%); CGPA ≈ (Previous_SGPA + SGPA) / 2
  (R² 0.992). Letter-grade points 4/3/2/1/0 overstate dataset SGPA by ~0.46, hence the linear mark scale.
- Full 50k run on 2026-10-16 took 3 min 11 s: Safe 23,320 · At-Risk 7,557 · Dropout-Likely 19,123.
- The model file's metadata holds the official metrics: CV macro F1 **0.9992**,
  test macro F1 **0.9994**, test accuracy **0.9996**.
- Labels are **policy-derived from a synthetic dataset** (`dataset_type`:
  "Synthetic policy-labelled student dataset"), not observed real-world outcomes.
- The dataset has one row per student (50,000 rows → 50,000 students), so each student's
  "history" is a single semester.
