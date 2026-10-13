# SmartEdu — Predictive Analytics for Student Performance/Retention

## Project layout

```
smartedu/
├── erd/                  ERD source (.dot) and rendered image
├── database/
│   ├── schema.sql         Full Postgres schema (run this first)
│   └── import_dataset.py  Loads the 50k-row CSV into the DB
├── backend/                Node.js + Express API
│   └── src/
│       ├── config/db.js
│       ├── middleware/     auth.js (JWT + role guard), audit.js
│       ├── controllers/    authController, studentController, facultyController, adminController
│       ├── routes/         one file per role
│       └── scripts/        hashPassword.js, createAdmin.js
├── ml_service/              FastAPI microservice serving the trained Random Forest model
└── frontend/                 React (Vite) app, 3 portals
```

## One-day setup order

1. **Postgres**
   ```bash
   createdb smartedu
   psql smartedu -f database/schema.sql
   ```

2. **Backend**
   ```bash
   cd backend
   cp .env.example .env      # edit DATABASE_URL, JWT_SECRET
   npm install
   node src/scripts/createAdmin.js "admin@smartedu.edu" "Admin@123"
   npm run dev                # http://localhost:5000
   ```

3. **Load the dataset**
   ```bash
   cd database
   pip install pandas psycopg2-binary bcrypt --break-system-packages
   python3 import_dataset.py --csv ../SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv \
       --dsn "postgresql://postgres:postgres@localhost:5432/smartedu"
   ```
   This creates one `users`+`students` row per unique `Student_ID` (default password
   `Student@123` for all seeded students — override with `--default-password`), and loads
   every row into `student_semester_performance`.

3b. **Seed faculty, courses, and class data (do this too — see note below)**
   The CSV only contains student-level data, so faculty/courses/enrollments/
   results/attendance are all empty after step 3. This script fills those in
   realistically, using students you just imported:
   ```bash
   python3 seed_demo_data.py --dsn "postgresql://postgres:postgres@localhost:5432/smartedu"
   ```
   This creates:
   - 10 faculty accounts (2 per department, password `Faculty@123` for all)
   - 20 courses (4 per department)
   - Class/section assignments — including one faculty member per department
     teaching 2 different courses across 2 sections, to demonstrate "faculty
     can teach multiple subjects and multiple classes"
   - 8 students per department enrolled into their department's classes
   - Per-course results and 8 sessions of attendance for each enrollment,
     derived from each student's real imported performance (with small
     realistic variation per course, not identical numbers everywhere)

   Run `database/demo_login_lookup.sql` in pgAdmin4's Query Tool afterward to
   get a ready list of faculty emails and enrolled student roll numbers/emails
   to log in with.

4. **ML microservice — using YOUR trained model**
   `ml_service/app.py` loads your actual trained pipeline, not a placeholder.
   ```bash
   cd ml_service
   pip install -r requirements.txt --break-system-packages
   ```
   Then get the model file itself:
   - Open your notebook (`SmartEdu_Complete_Data_Study_Jupyter.ipynb`) in Colab/Jupyter
     and run it through the cell that saves the model (the one producing
     `smartedu_final_model_outputs/smartedu_random_forest_version_a.pkl`).
   - Download that `.pkl` file and place it directly inside `ml_service/`
     (same folder as `app.py` — the filename must match exactly).
   - Start the service:
     ```bash
     uvicorn app:app --port 8001 --reload
     ```
   - Check it loaded correctly: open `http://localhost:8001/health` — it should
     list the 20 features the model expects (Semester, Department, Gender, Age,
     Attendance_Percentage, ... Scholarship, Hostel).

   The Node backend calls this at `POST /predict`, sending those exact 20 fields
   (built automatically in `studentController.js` from the `students` +
   `student_semester_performance` tables). If the ML service isn't running,
   predictions still work via a transparent rule-based fallback so the app
   never hard-fails — but for your actual demo, get the real model running.

5. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev                 # http://localhost:5173
   ```
   Vite proxies `/api` to `http://localhost:5000` (see `vite.config.js`).

6. **Log in**
   Go to `http://localhost:5173/login` with `admin@smartedu.edu` / `Admin@123`.
   From the admin **Users** page, create faculty accounts, then courses and
   faculty-course assignments from **Assignments**, then enroll students into
   classes. Faculty log in to enter results/attendance; students log in read-only.

## What still needs your input before the demo

- **50,000 imported students is a lot to browse.** The seed script only
  enrolls 8 students per department (40 total) into actual classes — those
  are the ones worth demoing. Everyone else has a working dashboard/CGPA/
  attendance view but no course-level detail, since they're not enrolled
  in anything.
- **The admin password hash in `schema.sql`** is commented out — use
  `node backend/src/scripts/createAdmin.js` instead (already in the setup steps above).
- **Deploying the ML service separately** (`ml_service/`) is optional for the demo —
  the rule-based fallback keeps the "helper bot" working without it if you're short on time.
