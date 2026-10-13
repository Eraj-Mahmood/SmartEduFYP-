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
   │  POST ML_SERVICE_URL (only from /api/student/prediction/refresh)
   ▼
FastAPI ML service (ml_service/, :8001) — loads smartedu_random_forest_version_a.pkl
```

- **Backend** (`backend/src/`)
  - `server.js` — helmet, CORS (`FRONTEND_ORIGIN`), morgan, login rate limit
    (20 requests / 15 min per IP on `/api/auth/login`), mounts the route files.
  - `config/db.js` — single `pg` Pool from `DATABASE_URL`.
  - `middleware/auth.js` — `authenticate` (JWT Bearer → `req.user = {userId, role, email}`)
    and `authorize(...roles)`. Role is enforced server-side on every router.
  - `middleware/audit.js` — `logAction()` writes to `audit_log`, never throws.
  - `routes/*Routes.js` + `controllers/*Controller.js`, one pair per area:
    - `auth` — `POST /login` (returns token, role, profile), `POST /change-password`, `GET /me`
    - `student` — read-only: dashboard, results, attendance, history, prediction,
      `POST /prediction/refresh` (calls the ML service and stores a `predictions` row)
    - `faculty` — own classes only (`assertOwnsClass`): roster, attendance, upsert results, mark attendance
    - `admin` — dashboard, user provisioning (temp passwords), directory, courses,
      faculty↔course assignment, enrollments, read-only class records, interventions/notifications
    - `notifications` — any logged-in user, scoped to `recipient_user_id`
  - `scripts/createAdmin.js`, `scripts/hashPassword.js`.
- **ML service** (`ml_service/app.py`) — loads a dict from the `.pkl`:
  `pipeline`, `feature_names` (20), `target_classes` (`['At-Risk','Dropout-Likely','Safe']`),
  metrics, `model_name`, `model_version`. `GET /health`, `POST /predict {features: {...}}`
  → `{label, prob_safe, prob_at_risk, prob_dropout, model_version}`.
  If the service is unreachable the backend uses `ruleBasedFallback()` (CGPA/warnings
  thresholds, `model_version = "rule_fallback"`).
- **Database** (`database/`)
  - `schema.sql` — tables: users, departments (5 seeded), students, faculty, courses,
    faculty_courses, enrollments, course_results, attendance,
    student_semester_performance, predictions, notifications, audit_log.
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
# ML service (port 8001)
cd ml_service; python -m uvicorn app:app --port 8001

# Backend (port 5000) — needs backend\.env (copy .env.example; never commit it)
cd backend; npm run dev

# Frontend (port 5173)
cd frontend; npm run dev
```

Fresh database setup: `createdb smartedu` → `psql -f database/schema.sql` →
`node backend/src/scripts/createAdmin.js "admin@smartedu.edu" "Admin@123"` →
`python database/import_dataset.py --csv SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv --dsn <DSN>` →
`python database/seed_demo_data.py --dsn <DSN>`.

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

## Known facts

- The prediction currently reads **only** `student_semester_performance` (the imported
  CSV row with the highest semester). Course results and attendance entered by faculty
  do not affect it.
- The model file's metadata holds the official metrics: CV macro F1 **0.9992**,
  test macro F1 **0.9994**, test accuracy **0.9996**.
- Labels are **policy-derived from a synthetic dataset** (`dataset_type`:
  "Synthetic policy-labelled student dataset"), not observed real-world outcomes.
- The dataset has one row per student (50,000 rows → 50,000 students), so each student's
  "history" is a single semester.
