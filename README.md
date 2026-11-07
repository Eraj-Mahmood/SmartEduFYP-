# SmartEdu - student dropout-risk prediction

SmartEdu flags students who are likely to struggle **before** the term ends. A trained Random Forest model
(scikit-learn) scores every student as **Safe**, **At-Risk** or **Dropout-Likely** from their marks, attendance
and history; an institutional policy can only make a label stricter, never milder. Students see their status,
the reasons in plain language and what to do next; faculty see risk in their own classes and enter marks and
attendance (labels update live); admins run predictions, assign counselors and send interventions.
The demo data is a **synthetic** 50,000-student dataset.

## Architecture

```
Browser ──► React + Vite + Tailwind (frontend/, http://localhost:5173)
              │  /api  (Vite dev proxy)
              ▼
            Node.js + Express API (backend/, :5000) ──► PostgreSQL (database "smartedu", :5432)
              │  POST /predict, /predict/batch
              ▼
            FastAPI ML service (ml_service/, :8001) - loads smartedu_random_forest_version_a.pkl
```

- Three sign-in portals: `/login/student`, `/login/faculty`, `/login/admin` (chooser at `/`).
- The trained model file and the 50k dataset CSV are committed, so a fresh clone runs without the training notebook.
- If the ML service is down, predictions fall back to the policy rules and are labelled as such.
- More detail for developers: [CLAUDE.md](CLAUDE.md).

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | 24 (tested 24.18; npm 11) | `node --version` |
| Python | 3.13 (tested 3.13.7) | `python --version` (Mac/Linux: `python3`) |
| PostgreSQL | 18 (17 also works) | the Windows service `postgresql-x64-18` is running |

Install PostgreSQL with the official installer and remember the password you give the `postgres` user.
`psql` is not needed. About 2 GB of free disk space is enough (the Python environment alone is ~400 MB).

## Install (once)

All commands are for **Windows PowerShell**, run from the project folder; Mac/Linux differences are noted.

### 1. Get the code

```powershell
git clone https://github.com/Eraj-Mahmood/SmartEduFYP-.git
cd SmartEduFYP-
```

### 2. Create `backend\.env`

```powershell
copy backend\.env.example backend\.env
```

Open `backend\.env` in a text editor and change these lines:

| Line | Set it to |
|---|---|
| `DATABASE_URL=` | `postgresql://postgres:YOUR_PASSWORD@localhost:5432/smartedu` (your PostgreSQL user, password and port; the database is created for you in step 4) |
| `JWT_SECRET=` | a long random string - generate one with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `LOGIN_RATE_LIMIT_MAX=` | `200` on your own machine (the default 20 blocks repeated test logins) |

Everything else can stay as it is. Only `backend\.env` exists - the frontend and the ML service need no `.env`.

**Optional - Gemini for free-form chat questions.** The assistant answers the common questions itself; an LLM is
only asked when it doesn't recognise a question. To use Google Gemini: create a key at Google AI Studio, then set
`CHAT_LLM_ENABLED=true`, `CHAT_LLM_PROVIDER=gemini` and paste the key right after `GEMINI_API_KEY=` (no spaces or
quotes). **Never commit the key, paste it into chat or share it** - `backend/.env` is git-ignored; keep it that way.
The free tier may use prompts to improve Google's products, so only use it with the synthetic demo data.

### 3. Install the dependencies

```powershell
cd backend;  npm ci;  cd ..
cd frontend; npm ci;  cd ..

cd ml_service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
cd ..

python -m pip install -r database\requirements.txt
```

- Mac/Linux: `python3 -m venv .venv` and `.venv/bin/python -m pip install ...`; `python3 -m pip install -r database/requirements.txt`.
- Low on disk space? Add `--no-cache-dir` to the `pip install` commands.
- The ML service must use **scikit-learn 1.9.0** (pinned in `requirements.txt`) - the model was saved with it.

### 4. Build the demo database: `npm run demo:reset`

Start the ML service first (the reset scores every student with the real model and stops if it isn't running):

```powershell
cd ml_service
.venv\Scripts\python -m uvicorn app:app --port 8001
```

Leave that window open. In a second PowerShell window:

```powershell
cd backend
npm run demo:reset
```

Type `yes` when asked. In 2-5 minutes it creates the `smartedu` database (or replaces it), applies the schema
and migrations, imports the 50k CSV, seeds faculty, courses, classes, marks and attendance, names the students,
creates the admin, seeds tutorials, imports the synthetic live cohort and predicts every student. It ends with a
summary and a fingerprint; the result is identical every time. Run it again whenever you want the demo data back as
new (`npm run demo:reset -- --yes` skips the question). It runs the database scripts with `python` on Windows and
`python3` on Mac/Linux; set `PYTHON=<path>` to use another interpreter.

## Start the app

Double-click **`start.cmd`** in the project folder (or run `powershell -ExecutionPolicy Bypass -File start.ps1`).
It opens one window per service, waits until all three answer and opens http://localhost:5173/.
To stop, close the three windows. Mac/Linux: `chmod +x start.sh` once, then `./start.sh` (Ctrl+C stops all three).

By hand, in three windows:

```powershell
cd ml_service; .venv\Scripts\python -m uvicorn app:app --port 8001   # http://localhost:8001/health lists 20 features
cd backend;    npm run dev                                           # http://localhost:5000/api/health
cd frontend;   npm run dev                                           # http://localhost:5173/
```

## Sign in

Open http://localhost:5173/ and choose a portal. Every account only signs in through its own portal.

| Portal | URL | Example account | Password |
|---|---|---|---|
| Admin | http://localhost:5173/login/admin | `admin@smartedu.edu` | `Admin@123` |
| Faculty | http://localhost:5173/login/faculty | `ayesha.khan@smartedu.edu` | `Faculty@123` |
| Student | http://localhost:5173/login/student | `student144766@smartedu.edu` | `Student@123` |

The six curated demo students (two per label), the faculty who teach them and every demo action, step by step,
are in [docs/DEMO_ACCOUNTS.md](docs/DEMO_ACCOUNTS.md).

## Run the tests

| Suite | Command | Needs |
|---|---|---|
| Backend API + unit (Jest, 453 tests) | `cd backend; npm test` (`npm run test:coverage` for coverage) | database |
| ML service (pytest, 29 tests) | `cd ml_service; .venv\Scripts\python -m pytest tests` | - |
| Chat assistant evaluation (363 questions) | `cd backend; node ../evaluation/chat_eval.js` | database |
| Demo actions (perform + undo each one) | `cd backend; node ../evaluation/demo_actions_check.js` | all services; reset afterwards |
| Manual test cases (51, API + browser) | `cd backend; node ../evaluation/test_cases.js` | all services; reset before and after |
| Performance at 50k students | `cd backend; node ../evaluation/perf_check.js` | all services, ~25 min |
| Screenshots | `cd frontend; npx playwright install chromium` once, then `npm run screenshots` | all services |
| Frontend build | `cd frontend; npm run build` | - |

Results: [docs/TEST_CASES.md](docs/TEST_CASES.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md),
[docs/chat_eval.md](docs/chat_eval.md); numbers for the report: [docs/REPORT_EVIDENCE.md](docs/REPORT_EVIDENCE.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| ML service: `ColumnTransformer has no attribute 'force_int_remainder_cols'` or version warnings | Wrong scikit-learn. Always start it with `ml_service\.venv\Scripts\python` and install `requirements.txt` (scikit-learn 1.9.0) into that venv. |
| `demo:reset` stops with "the ML service is not reachable" | Start the ML service first (step 4) and check http://localhost:8001/health. |
| `demo:reset`: "can't import psycopg2, pandas and bcrypt" | `python -m pip install -r database\requirements.txt`, or point it at another Python: `$env:PYTHON="C:\path\to\python.exe"; npm run demo:reset`. |
| `password authentication failed for user "postgres"` | The password in `DATABASE_URL` in `backend\.env` is wrong. |
| `EADDRINUSE` / port 5000, 5173 or 8001 in use | Another copy is still running. Find it with `Get-NetTCPConnection -State Listen -LocalPort 5000` and stop that process: `Stop-Process -Id <OwningProcess>` (Mac/Linux: `lsof -i :5000`, then `kill <pid>`). |
| Sign-in says "Too many login attempts" | The login rate limit (`LOGIN_RATE_LIMIT_MAX` per 15 minutes). Raise it to 200 in `backend\.env` for development and restart the backend. |
| "This is a faculty account - please use the Faculty sign in" | You used another role's portal; press the button to switch. |
| Chat says "Sorry, I can't answer that one" to free-form questions | Gemini is off, has no key, or answered 429 (free-tier quota), 503 (high demand) or took longer than 8 s. The app falls back to its own answers (`source = fallback`); the common questions never need Gemini. Wait or set `CHAT_LLM_MODEL` to another Gemini model. |
| A live-cohort student (`SYN-...`) can't sign in | They were imported with a random password. Admin -> Users -> search the roll number -> Reset password. |
| Charts empty / everything "Rule estimate" | The ML service was down when predictions ran. Start it and run Admin -> Overview -> Run predictions (or `npm run demo:reset`). |
