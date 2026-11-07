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
  - `app.js` — the Express app: helmet, CORS (`FRONTEND_ORIGIN`), morgan (off under Jest), login
    rate limit on `/api/auth/login` (`LOGIN_RATE_LIMIT_MAX`, default 20, per
    `LOGIN_RATE_LIMIT_WINDOW_MIN` minutes, default 15, per IP; 200 in the local `.env`), the route
    files and the error handler. Tests import it. `server.js` only listens and on start marks
    unfinished `prediction_runs` as failed (runs are processed in memory).
  - `config/db.js` — single `pg` Pool from `DATABASE_URL`. DATE columns (OID 1082) are returned
    as raw `'YYYY-MM-DD'` strings (no UTC day shift).
  - `middleware/auth.js` — `authenticate` (JWT Bearer → `req.user = {userId, role, email, mustResetPw}`)
    and `authorize(...roles)`. Role is enforced server-side on every router. `authenticate` does one
    primary-key lookup per request: a deactivated or deleted user's token gets **401
    `ACCOUNT_DISABLED`** at once, and while `must_reset_pw` is TRUE every route except
    `/api/auth/change-password`, `/api/auth/me` and `/api/auth/logout` gets **403
    `PASSWORD_RESET_REQUIRED`**. The same lookup reads `users.password_changed_at` (migration 010): a token
    issued before it (the token's `iatMs` claim, else `iat`) gets **401 `TOKEN_REVOKED`**; change-password
    and `createAdmin.js` set it, and change-password returns a fresh token.
  - `middleware/audit.js` — `logAction()` writes to `audit_log`, never throws.
  - `middleware/validate.js` — turns express-validator errors into `400 {error, details}`.
  - `routes/*Routes.js` + `controllers/*Controller.js`, one pair per area:
    - `auth` — `POST /login` (returns token, role, `mustResetPassword`, profile), `POST /change-password`
      (current password + new one with 8+ chars, upper, lower and a digit, not the current one; returns a
      fresh token; audit-logged), `GET /me` (with `mustResetPassword`), `POST /logout` (stateless no-op).
      Only accounts created in the admin UI start with `must_reset_pw = TRUE` (migration 005 cleared it
      for imported students, seeded faculty and the createAdmin admin).
    - `student` — read-only: dashboard, results, attendance, history, prediction,
      `GET /prediction/timeline` (latest prediction per day, last 30 days: date, final_label,
      projected_cgpa), `POST /prediction/refresh` (runs `predictForStudent`).
      `GET /dashboard` returns `profile`, `officialCgpa` (imported) and `projectedCgpa` /
      `provisionalSgpa` / `previousSgpa` (from the latest prediction's features), each with
      `label` + `source`; `liveAttendance` (live, else imported, with `source`); `latestPrediction`;
      `weakestCourse`; `courses` (marks, derived grade, attendance %); `coursesBelowPassMark`;
      `thresholds` (pass mark + policy.json); `latestPrediction` also has `status_since` and
      `label_ever_changed` (the dashboard shows the timeline chart only if the label ever changed);
      `recommendation` (`{course, tutorial, reason}` from `services/tutorials.js`, or null) and `counselor`
      (`{name, designation, email, department, assigned_at}` or null) for the "What to do next" card.
      Built by `services/studentOverview.js`. `GET /next-steps` → ranked steps (`services/nextSteps.js`).
      Chat: `POST /chat {message}` (1-500 chars after trim, else 400; `CHAT_RATE_LIMIT_PER_MIN`
      per user, default 20 → 429), `GET /chat/history` (last 50, oldest first; assistant rows carry `meta`
      `{intent, suggestions, links}` so a reloaded chat keeps its chips and links), `DELETE /chat/history`
      (own only). Student responses never include probabilities, `drivers` (SHAP numbers) or `features`.
    - `faculty` — own classes only (`assertOwnsClass`, 403 otherwise): `GET /classes` (with latest-label
      counts `safe` / `at_risk` / `dropout_likely`), `GET /classes/:id/roster` (adds final_label, reasons,
      policy_reason, projected_cgpa, attendance % in the class, last_predicted_at),
      `GET /classes/:id/risk-summary` (counts, A-F grade distribution, attendance % per session date),
      `GET /classes/:id/attendance`, `PUT /results/:enrollmentId` (returns the saved row with the
      server-derived grade plus `prediction: {old_label, new_label, changed, reasons, projected_cgpa}`),
      `POST /attendance` (every enrollment must belong to the class, else 403 and nothing is written;
      a dropped enrollment → 400). Roster, attendance list and risk summary exclude `status='dropped'`.
      Roster and result-save reasons use the staff wording.
      Counselees: `GET /counselees` (my ACTIVE assignments, each with final_label, staff reasons, next steps,
      recommended tutorial, attendance, notes, last_contacted_at), `GET /counselees/:id`, `PUT /counselees/:id
      {notes?, last_contacted_at?, close?}` (not in the future; audit-logged). Someone else's or a closed
      assignment → 403. A counselor sees this summary even for students outside their classes, nothing more.
      Inputs validated with express-validator (marks 0-100, date, status enum, ids). The server
      derives the grade (`services/grading.js`); a client-sent grade is ignored. Saves set
      `data_source='live'` and re-predict (see below).
    - `admin` — dashboard, user provisioning (temp passwords), directory, courses,
      faculty↔course assignment, enrollments, read-only class records, interventions/notifications,
      batch runs: `POST /predictions/run {scope: "all"|"department"|"class", scopeId}` → `202` with the
      `prediction_runs` row (one run at a time, else `409`); `GET /predictions/runs/:id` for progress;
      `GET /predictions/runs?limit=20` lists recent runs (scope name, who, duration).
      `GET /students/:id/full` → profile, performance history (no `target_label`), every prediction (staff
      reasons), course results, `nextSteps` (staff wording) and `counselor`; 400 bad id, 404 unknown. The
      Interventions page opens it in `AdminStudentDrawer` (click a student's name).
      `GET /dashboard` → `kpis` (students, faculty, courses, flagged, predicted, lastRun), `riskCounts`,
      `riskByDepartment`, `runsTrend` (label counts per run). `/at-risk-students` and `/predictions` are
      server-paginated `{rows, total, page, limit, totalPages}` with filters `department` (id), `label`,
      `semester`, `search` and `sort` (severity | recent | roll | cgpa); `limit` ≤ 100. All of these use
      each student's **latest** `final_label`, read through `students.latest_prediction_id` (migration
      003; `predictionService` moves it in the same transaction as each insert, forward-only). Reasons
      in admin views use the staff wording. `/at-risk-students` also takes `noCounselor=1` and
      `notContacted=1` (no intervention sent and no counselor contact recorded) and each row carries
      `weakest_course`, `tutorial`, `counselor` and `last_intervention_at`; `GET /at-risk-students/export`
      → the same list as CSV (roll_no, name, department, label, top_reason, weakest_course, counselor,
      last_intervention; UTF-8 BOM, formula-safe, streamed in 2000-row chunks; audit-logged).
      Phase 4 (all writes audit-logged):
      - Tutorials: `GET /tutorials?courseId=`, `POST /tutorials`, `PUT /tutorials/:id` (any field, incl.
        `is_active`), `PUT /tutorials/:id/deactivate` (`controllers/tutorialController.js`).
      - Counselors (`controllers/counselorController.js`): `POST /counselors {studentId, facultyId}` (links
        the latest prediction; an existing active assignment is closed first; same counselor → 409),
        `PUT /counselors/:id/close`, `GET /counselors?status&department&faculty&page&limit`,
        `GET /faculty/workload?department=` (active counselees per faculty, that department first).
        Assigning notifies the student ("<Name> is now your academic counselor") and the faculty member
        ("You've been assigned as counselor to <Name> (<label>)").
      - Interventions: `POST /notifications` (to a student: placeholders + `includeTutorial`, default on
        for flagged students), `POST /notifications/bulk {studentIds | filter, subject, message,
        includeTutorial}` (≤ 500 ids else 400; a filter sends to the 500 most severe and reports
        `matched`/`capped`), `POST /notifications/preview {studentId, ...}` (one filled-in copy, not sent).
        Placeholders `{name}`, `{course}`, `{counselor}`; unknown ones are kept and returned in
        `unknownPlaceholders`.
      - Governance (`controllers/governanceController.js`): `PUT /users/:userId/deactivate` and
        `/reactivate` (404 unknown; an admin can't deactivate themselves), `GET /audit-log?actor&action&
        entity&from&to&page&limit` (newest first, plus the distinct actions/entities for the filters).
    - `notifications` — any logged-in user, scoped to `recipient_user_id`; rows carry `link` (the in-app
      screen a click opens), `kind` (`intervention` | `counselor`) and `related_tutorial_id`
  - `scripts/createAdmin.js`, `scripts/hashPassword.js`, `scripts/migrate.js`,
    `scripts/seedTutorials.js` (study material for every course; fetches every URL first and stores
    any that fails as inactive, listing it; re-runs never re-activate an admin-deactivated row;
    `--no-check` skips the fetches).
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
    - `reasons.js` — `toReasons(drivers, features, finalLabel, {audience})` → up to 3 sentences, no
      SHAP numbers. `audience: 'student'` (default, stored in `predictions.reasons`: "Your CGPA (1.98) is
      below 2.00") or `'staff'` ("CGPA 1.98 is below 2.00"); `staffReasons(row)` rebuilds staff wording
      from a stored row. The student dashboard also rebuilds on read, so the wording is always current
      (older prediction rows can predate wording fixes). Wording never sounds more severe than `finalLabel` ("high-risk
      range" and "severe-absence limit" only for Dropout-Likely).
    - `studentCourses.js` (`getCourseSummary`: this term's marks, grade, attendance, weakest course =
      lowest mean, ties → lowest attendance), `studentOverview.js` (`getStudentOverview`: the dashboard payload).
    - `tutorials.js` — `recommendFor(studentId, {summary?, label?})` → `{course, tutorial, reason}` or null:
      the weakest current course, recommended when its mean < 70, its attendance < 75% or the student is
      At-Risk/Dropout-Likely; `tutorial` = the course's first active tutorial (lowest id) or null;
      `reason` one sentence ("Your AI402 average is 66 - this covers its core topics").
    - `counselors.js` — `assignCounselor` (one transaction, student row locked), `closeAssignment`,
      `getActiveCounselor`, `counseleeSummary` (the staff summary), `facultyAssignments`.
    - `interventions.js` — `fillTemplate`, `compose` (per-student copy + tutorial line), `sendInterventions`
      (one transaction), `MAX_BULK = 500`.
    - `nextSteps.js` — `getNextSteps(id)` → `[{id, priority, text, detail}]`, most important first:
      `attendance` (sessions in a row to reach 75%, and 60% when below), `marks` (whole-number average
      needed in every course for projected CGPA 2.00 and 2.30 with the Phase 1 formulas; honest when
      2.30 needs > 100, then a realistic goal; notes when attendance also blocks Safe), `weakest_course`
      (mean < 70), `tutorial` (the recommended tutorial, priority 41), `submission` (< 90%).
      `getNextSteps(id, {audience: 'staff'})` describes the student instead of addressing them ("Needs a
      72 (B) average in every course to reach 2.30"); used by the counselee summary and the admin student view.
      `whatIfFeatures(features, mark)` is used by
      `evaluation/next_steps_whatif.js` (model agreed 12/12 on the 4 At-Risk/Dropout-Likely demo students).
    - `predictionService.js` — `predictForStudent(id, {trigger})`, `predictForMany(ids, {runId, trigger})`:
      build features → ML `/predict` or `/predict/batch` (on failure `ruleBasedFallback`, which uses
      the policy.json rules, `source='fallback'`, `drivers=null`) → policy → reasons → insert into
      `predictions`.
    - `predictionRuns.js` — admin runs in the background, 1000 students per chunk.
    - `grading.js` — grade from marks (equal weights; A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40), same as the seed.
  - **Chat ("Ask SmartEdu")** — `services/chatService.js` runs one turn: `chatContext.js`
    `buildChatContext(studentId)` (student id from the JWT only; profile + own email, official/projected
    CGPA, SGPA, label + student-wording reasons, per-course marks/grade/attendance, weakest course, next
    steps, `tutorial` (the recommendation, or null), `counselor` (or null), last 3 interventions; no
    probabilities) →
    **Layer 1** `chatbot.js` `respond(message, ctx, {catalog})` → **Layer 2** `chatLlm.js` only if the
    intent is `unknown` and `CHAT_LLM_ENABLED=true` with `ANTHROPIC_API_KEY` set → both messages saved
    to `chat_messages` (migration 004) in one transaction, `source` = template | llm | fallback.
    - Layer 1 normalises the message (lowercase, no punctuation), matches English + Roman Urdu keywords
      and course codes/titles, in this order: `wellbeing` (self-harm wording → emergency number),
      `other_student` (another roll no / student ID / email, a name + CGPA/marks/result, "my friend's",
      topper → one fixed refusal that never confirms the student exists), `course_detail`, `attendance`,
      `who_can_help` (names the counselor + email when there is one), `why_risk`, `weakest_course`,
      `my_marks` ("What are my marks?", "mere marks": every course's average, grade and components; not
      when the message asks how to improve), `improve`, `standing`, `greeting`, `unknown`.
      `weakest_course` and `improve` add a "Study material for …" line and an external link to the
      recommended tutorial (the chat panel opens http(s) links in a new tab).
      Answers ≤ 120 words, real numbers, no probabilities or promises, ≤ 3 suggestions + page links,
      wording varies. Support contacts come from `config/support.json` (**placeholders — replace**).
    - Layer 2: `@anthropic-ai/sdk` 0.131.0, `CHAT_LLM_MODEL` (default `claude-haiku-5-5`),
      `CHAT_LLM_TIMEOUT_MS` (8000, no retries), effort low; system prompt keeps it to the JSON context.
      Post-check: any other roll no / student ID / email → refusal template. Timeout/error/refusal →
      Layer 1 unknown reply (`source='fallback'`). Only the error class is logged, never the key.
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
  If the service is unreachable the backend uses `ruleBasedFallback()` (the policy.json rules,
  `model_version = "rule_fallback"`, `source = 'fallback'`).
- **Frontend** (`frontend/src/`)
  - `components/ui/` — the UI kit (import from `components/ui`): `RiskChip` (icon + text; `supportive`
    shows the student wording with the formal label underneath, `short` the staff wording),
    `Card`, `StatCard` (label, value, sublabel, trend, info tooltip, tone), `ChartCard` (title,
    subtitle, loading/empty states), `EmptyState`, `Skeleton`/`SkeletonText`/`SkeletonCard`,
    `Toast` (`ToastProvider` in App.jsx + `useToast()`), `Drawer` (right panel, full screen on phones),
    `Modal` (centered dialog, bottom sheet on phones), `buttonClass(variant, size)` (button look for `<a>`),
    `DataTable` (sortable columns, client-side or server-side via `sort`/`onSortChange`; scrolls
    horizontally inside its card) + `Pagination`, `Button`, `Tooltip`, `icons.jsx`.
    `tokens.js` holds the design tokens (colours) shared by `tailwind.config.js` and the charts.
    `risk.js` is the one map of label wording (Safe → "You're on track", At-Risk → "Needs attention",
    Dropout-Likely → "High risk - let's act now").
  - `components/Shell.jsx` — `PortalShell`: per-role navigation (`NAV`), active link state, bell,
    collapsible menu below `md`. `RiskBadge`/`Card` exports kept for compatibility.
  - `components/charts/theme.jsx` — shared recharts axis/grid styles, `TooltipBox`, HTML `Legend`.
  - `lib/useApi.js` (`{data, error, loading, reload, setData}`), `lib/format.js` (timeAgo, gpa, pct,
    shortDate - parses `YYYY-MM-DD` as a local date).
  - Pages: student (`StudentDashboard` + `StudentCharts` + `WhatToDoNext` (counselor card, tutorial card,
    next steps; `#what-next`), Results, Attendance), faculty (`FacultyDashboard`, `ClassRoster` with
    filters/search/drawer/inline marks + label-change toast, `MarkAttendance`, `MyCounselees` (list +
    drawer with autosaving notes, Mark contacted today, Close assignment; `?open=<id>`)), admin
    (`AdminDashboard` + `AdminCharts` + `RunPredictionsCard`, `Interventions` (workflow table, filters,
    multi-select; `InterventionModals.jsx`: assign-counselor picker with workloads + close, compose with
    placeholder chips and live preview; Export CSV), `Tutorials` (`?course=<id>`), ManageUsers (with
    deactivate/reactivate), Assignments, `AuditLog` (filters + JSON drawer)), `ChangePassword` (forced:
    standalone, before anything else; voluntary: Account menu).
  - Auth flow: `localStorage.smartedu_must_reset` is set from login's `mustResetPassword` or by the axios
    interceptor on 403 `PASSWORD_RESET_REQUIRED`; `ProtectedRoute` then sends everything to
    `/change-password`. On 401 `ACCOUNT_DISABLED` or `TOKEN_REVOKED` the interceptor returns to /login
    with the notice. The faculty "My classes" link is also highlighted on class pages (`also` prefixes in `NAV`).
    Notification clicks navigate to `notification.link`.
  - `components/assistant/AssistantPanel.jsx` — the "Ask SmartEdu" chat: right panel (full-screen
    sheet on phones), starter chips, bubbles, typing indicator, suggestion chips + link buttons,
    Enter/Shift+Enter, 400+/500 counter, history on open, Clear chat with confirmation, error + retry,
    document-level focus trap/Escape, aria-live answers. Opened from the dashboard header button or
    "Ask about this" in the status hero (pre-sends "Why is my status this?").
  - Screenshots: `cd frontend; npm run screenshots` (Playwright; one-time `npx playwright install
    chromium`) logs in as admin, ayesha.khan and the 6 demo students and saves full-page screenshots of
    every main screen at 1280px and 390px to `docs/screenshots/`, plus the chat panel after 3 questions
    for BU-100040 / BU-112907 / BU-144766 (one per label; their chat history is cleared before and
    after), and the Phase 4 screens (assign modal, bulk intervention composer, Tutorials, Audit log,
    My counselees + drawer, the student "What to do next" card, Change Password forced and voluntary).
    Those use BU-115624 with Mr. Zain Abbas as counselor (assigned for the run, closed at the end), so
    the demo accounts are untouched. Needs all three services running; it also reports horizontal
    overflow and page errors.
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
    `003_latest_prediction_pointer.sql` — `students.latest_prediction_id` (FK, backfilled, indexed).
    `004_chat_messages.sql` — `chat_messages` (student_id, role, content, intent, source, created_at;
    index `(student_id, created_at)`).
    `005_chat_meta_and_reset_flags.sql` — `chat_messages.meta`; `must_reset_pw = FALSE` for every account
    not created in the admin UI. `006_tutorials.sql` — `tutorials` (course_id, title, url, provider,
    kind video|notes|practice, description, is_active, created_by; unique (course_id, url)).
    `007_counselor_assignments.sql` — `counselor_assignments` (partial unique index: one active per
    student) and `notifications.link`. `008_notification_tutorial.sql` — `notifications.related_tutorial_id`
    and `kind`. `009_audit_log_indexes.sql`. `010_password_changed_at.sql` — `users.password_changed_at`.
  - `import_dataset.py` — loads the 50k-row CSV: one user+student per `Student_ID`
    (email `student<ID>@smartedu.edu`, roll `BU-<ID>`) and one
    `student_semester_performance` row each (incl. the dataset's `target_label`).
  - `seed_demo_data.py` — 10 faculty, 20 courses, sections, and 8 random students per
    department enrolled in their department's section-A classes, with results and
    8 attendance sessions derived from their performance row.
  - `generate_student_names.py` — replaces "Student 12345" with random names (only `full_name`);
    run on 2026-10-16, the demo names are in docs/DEMO_ACCOUNTS.md.
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
`python database/seed_demo_data.py --dsn <DSN>` → `cd backend; npm run migrate` →
`node src/scripts/seedTutorials.js`.

Schema changes go in a new numbered file in `database/migrations/` (e.g. `001_add_x.sql`),
applied with `cd backend; npm run migrate` (`src/scripts/migrate.js`: filename order, one
transaction per file, recorded in `schema_migrations`, already-applied files skipped).

Tests and evaluations:

```powershell
cd backend; npm test                              # Jest + Supertest against the local smartedu DB (ML not needed)
cd backend; node ../evaluation/chat_eval.js       # chat router eval -> docs/chat_eval.md (exit 1 on any fail);
                                                  # includes my_marks, improve-with-tutorial and who_can_help with a counselor
cd backend; node ../evaluation/next_steps_whatif.js  # suggested marks vs the real model (ML running)
```

Chat env vars (`backend/.env`, documented in `.env.example`): `CHAT_RATE_LIMIT_PER_MIN` (20),
`CHAT_LLM_ENABLED` (false), `ANTHROPIC_API_KEY` (never commit), `CHAT_LLM_MODEL` (claude-haiku-5-5),
`CHAT_LLM_TIMEOUT_MS` (8000). The demo works with the LLM off.

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
live re-prediction demo (one faculty save that moves BU-112907 from At-Risk to Safe), the chat demo,
and the Phase 4 interventions demo (demo script step 6) with how to undo it.

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
- Latest full 50k run (run 10, 2026-10-16, after the Phase 3 changes) took 1 min 37 s, all from the
  model (no fallback): Safe 23,320 · At-Risk 7,557 · Dropout-Likely 19,123. It refreshed every
  student's stored reasons (none of the latest rows still use pre-fix wording).
- The model file's metadata holds the official metrics: CV macro F1 **0.9992**,
  test macro F1 **0.9994**, test accuracy **0.9996**.
- Tutorials (seeded 2026-11-07): 35 for all 20 courses, every course has an active one. Stanford CS224N
  still fails the HTTP check (connection reset, re-checked 2026-11-07) and stays inactive. The OpenCV 4.x
  tutorial index answers 403 to Node's fetch (Cloudflare) but 200 to curl with a browser User-Agent, so it
  was re-activated (2026-11-07) and the seeder now asks curl before marking a URL failed. The seed has 20
  courses, not 22.
- Labels are **policy-derived from a synthetic dataset** (`dataset_type`:
  "Synthetic policy-labelled student dataset"), not observed real-world outcomes.
- The dataset has one row per student (50,000 rows → 50,000 students), so each student's
  "history" is a single semester.
