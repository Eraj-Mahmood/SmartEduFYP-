const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { startRun, getRun } = require("../services/predictionRuns");
const { staffReasons } = require("../services/reasons");
const interventions = require("../services/interventions");
const { recommendFor } = require("../services/tutorials");
const { getNextSteps } = require("../services/nextSteps");
const { getActiveCounselor } = require("../services/counselors");

// Latest prediction per student, via the students.latest_prediction_id pointer
const LATEST_PREDICTIONS = `SELECT p.* FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id`;

const LABELS = ["Safe", "At-Risk", "Dropout-Likely"];

// A student "has live data" when they came from a live cohort import or any of their current
// marks/attendance rows were entered in the app or uploaded (data_source = 'live').
// The set of students with live rows is small, so it is built once (hashed) rather than probed with
// EXISTS for each of the 50,000 students.
const HAS_LIVE_DATA = `(s.data_source = 'live' OR s.student_id IN (
  SELECT le.student_id FROM enrollments le JOIN course_results lcr ON lcr.enrollment_id = le.enrollment_id WHERE lcr.data_source = 'live'
  UNION
  SELECT le.student_id FROM enrollments le JOIN attendance la ON la.enrollment_id = le.enrollment_id WHERE la.data_source = 'live'))`;
const SEVERITY_ORDER = "CASE p.final_label WHEN 'Dropout-Likely' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END";
const SORTS = {
  severity: `${SEVERITY_ORDER}, p.prob_dropout DESC NULLS LAST, p.roll_no`,
  recent: "p.created_at DESC, p.prediction_id DESC",
  roll: "p.roll_no",
  cgpa: "p.projected_cgpa ASC NULLS LAST, p.roll_no",
};

/**
 * Paginated, filtered list of each student's LATEST prediction.
 * Query: page, limit (<= 100), department (department_id), label, semester (current semester),
 * search (roll no, name or email), sort (severity | recent | roll | cgpa).
 * riskOnly limits the list to At-Risk and Dropout-Likely.
 */
/**
 * WHERE conditions for the latest-prediction lists (aliases: p = latest prediction, s = students,
 * u = users). q: label, department (id), semester, search, noCounselor, notContacted,
 * dataSource (live = has live data, see HAS_LIVE_DATA; synthetic = none).
 * noCounselor: no active counselor. notContacted: no intervention message sent yet and no
 * contact recorded by a counselor.
 */
function latestFilters(q, { riskOnly = false } = {}) {
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\?/g, `$${params.length}`)); // every ? in one condition is the same value
  };
  const yes = (v) => v === true || v === "1" || v === "true";
  if (riskOnly) where.push("p.final_label IN ('At-Risk', 'Dropout-Likely')");
  if (q.label && LABELS.includes(q.label)) add("p.final_label = ?", q.label);
  if (parseInt(q.department)) add("s.department_id = ?", parseInt(q.department));
  if (parseInt(q.semester)) add("s.current_semester = ?", parseInt(q.semester));
  const search = String(q.search || "").trim();
  if (search) add("(s.roll_no ILIKE ? OR s.full_name ILIKE ? OR u.email ILIKE ?)", `%${search}%`);
  if (q.dataSource === "live") where.push(HAS_LIVE_DATA);
  if (q.dataSource === "synthetic") where.push(`NOT ${HAS_LIVE_DATA}`);
  if (yes(q.noCounselor)) {
    where.push("NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id AND ca.status = 'active')");
  }
  if (yes(q.notContacted)) {
    where.push(`NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_user_id = s.user_id AND COALESCE(n.kind, 'intervention') = 'intervention')
      AND NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id AND ca.last_contacted_at IS NOT NULL)`);
  }
  return { where, params };
}

/**
 * Adds the intervention workflow columns to at-risk rows (one page, <= 100 rows):
 * weakest_course + tutorial (the recommender's pick), counselor (active assignment) and
 * last_intervention_at (latest admin intervention message).
 */
async function withWorkflow(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.student_id);
  const [counselors, sent, recs] = await Promise.all([
    pool.query(
      `SELECT ca.student_id, ca.id, ca.faculty_id, f.full_name, ca.last_contacted_at, ca.created_at
       FROM counselor_assignments ca JOIN faculty f ON f.faculty_id = ca.faculty_id
       WHERE ca.status = 'active' AND ca.student_id = ANY($1)`,
      [ids]
    ),
    pool.query(
      `SELECT s.student_id, MAX(n.sent_at) AS last_sent
       FROM students s JOIN notifications n ON n.recipient_user_id = s.user_id
       WHERE s.student_id = ANY($1) AND COALESCE(n.kind, 'intervention') = 'intervention'
       GROUP BY s.student_id`,
      [ids]
    ),
    Promise.all(rows.map((r) => recommendFor(r.student_id, { label: r.final_label }))),
  ]);
  const cBy = new Map(counselors.rows.map((c) => [c.student_id, c]));
  const sBy = new Map(sent.rows.map((x) => [x.student_id, x.last_sent]));
  return rows.map((r, i) => {
    const c = cBy.get(r.student_id);
    const rec = recs[i];
    return {
      ...r,
      weakest_course: rec ? { course_id: rec.course.course_id, course_code: rec.course.course_code, title: rec.course.title, mean: rec.course.mean } : null,
      tutorial: rec && rec.tutorial ? { tutorial_id: rec.tutorial.tutorial_id, title: rec.tutorial.title, url: rec.tutorial.url } : null,
      counselor: c ? { assignment_id: c.id, faculty_id: c.faculty_id, name: c.full_name, last_contacted_at: c.last_contacted_at, assigned_at: c.created_at } : null,
      last_intervention_at: sBy.get(r.student_id) || null,
    };
  });
}

async function latestPredictionPage(req, { riskOnly = false, withCourses = false } = {}) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const { where, params } = latestFilters(req.query, { riskOnly });
  const order = SORTS[req.query.sort] || SORTS.severity;

  const base = `
    WITH latest AS (
      SELECT p.student_id, p.prediction_id, p.final_label, p.model_label, p.prob_dropout, p.reasons,
             p.policy_reason, p.source, p.created_at, (p.features->>'CGPA')::numeric AS projected_cgpa
      FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
    ),
    filtered AS (
      SELECT p.*, s.roll_no, s.full_name, s.current_semester, s.department_id, u.user_id, u.email,
             d.code AS department_code, d.name AS department
      FROM latest p
      JOIN students s ON s.student_id = p.student_id
      JOIN users u ON u.user_id = s.user_id
      JOIN departments d ON d.department_id = s.department_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
    )`;

  const [count, rows] = await Promise.all([
    pool.query(`${base} SELECT COUNT(*)::int AS total FROM filtered`, params),
    pool.query(
      `${base},
       pg AS (SELECT * FROM filtered p ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2})
       SELECT p.*, p.final_label AS predicted_label, x.drivers, x.features${
         withCourses
           ? `, (SELECT COALESCE(array_agg(c.course_code ORDER BY c.course_code), '{}')
                FROM enrollments e
                JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
                JOIN courses c ON c.course_id = fc.course_id
                WHERE e.student_id = p.student_id AND e.status = 'enrolled') AS courses`
           : ""
       }
       FROM pg p JOIN predictions x ON x.prediction_id = p.prediction_id ORDER BY ${order}`,
      [...params, limit, (page - 1) * limit]
    ),
  ]);
  const total = count.rows[0].total;
  // staff wording ("CGPA 1.98 is below 2.00"); drivers and features are not sent
  const out = rows.rows.map(({ drivers, features, ...r }) => ({ ...r, reasons: staffReasons({ ...r, drivers, features }) }));
  return { rows: riskOnly ? await withWorkflow(out) : out, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// crypto-random (services/passwords.js); was Math.random
const randomPassword = () => require("../services/passwords").temporaryPassword();

/** GET /api/admin/departments - for populating the dropdown in the create-user form */
async function listDepartments(req, res) {
  try {
    const { rows } = await pool.query("SELECT department_id, code, name FROM departments ORDER BY name");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/dashboard - KPIs, risk counts (overall and per department) and the run trend.
 *  Every count uses each student's LATEST final_label. */
async function dashboard(req, res) {
  try {
    const [students, faculty, courses, risk, byDept, lastRun, runs, sources] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n FROM students"),
      pool.query("SELECT COUNT(*)::int AS n FROM faculty"),
      pool.query("SELECT COUNT(*)::int AS n FROM courses"),
      pool.query(
        `WITH latest AS (${LATEST_PREDICTIONS})
         SELECT final_label, COUNT(*)::int AS count FROM latest GROUP BY final_label`
      ),
      pool.query(
        `WITH latest AS (${LATEST_PREDICTIONS})
         SELECT d.department_id, d.code, d.name,
                COUNT(p.student_id)::int AS total,
                COUNT(*) FILTER (WHERE p.final_label = 'Safe')::int AS safe,
                COUNT(*) FILTER (WHERE p.final_label = 'At-Risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE p.final_label = 'Dropout-Likely')::int AS dropout_likely
         FROM departments d
         LEFT JOIN students s ON s.department_id = d.department_id
         LEFT JOIN latest p ON p.student_id = s.student_id
         GROUP BY d.department_id ORDER BY d.code`
      ),
      pool.query("SELECT * FROM prediction_runs ORDER BY started_at DESC LIMIT 1"),
      pool.query(
        `SELECT r.id, r.scope, r.scope_id, r.status, r.started_at, r.finished_at, r.total, r.done, r.failed,
                COUNT(*) FILTER (WHERE p.final_label = 'Safe')::int AS safe,
                COUNT(*) FILTER (WHERE p.final_label = 'At-Risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE p.final_label = 'Dropout-Likely')::int AS dropout_likely
         FROM (SELECT * FROM prediction_runs ORDER BY started_at DESC LIMIT 20) r
         LEFT JOIN predictions p ON p.run_id = r.id
         GROUP BY r.id, r.scope, r.scope_id, r.status, r.started_at, r.finished_at, r.total, r.done, r.failed
         ORDER BY r.started_at`
      ),
      dataSources(),
    ]);
    const counts = Object.fromEntries(LABELS.map((l) => [l, 0]));
    risk.rows.forEach((r) => (counts[r.final_label] = r.count));
    res.json({
      kpis: {
        students: students.rows[0].n,
        faculty: faculty.rows[0].n,
        courses: courses.rows[0].n,
        flagged: counts["At-Risk"] + counts["Dropout-Likely"],
        predicted: counts.Safe + counts["At-Risk"] + counts["Dropout-Likely"],
        lastRun: lastRun.rows[0] || null,
      },
      riskCounts: LABELS.map((label) => ({ label, count: counts[label] })),
      riskByDepartment: byDept.rows,
      runsTrend: runs.rows,
      dataSources: sources,
      // kept for older clients
      totalStudents: students.rows[0].n,
      totalFaculty: faculty.rows[0].n,
      totalCourses: courses.rows[0].n,
      riskBreakdown: LABELS.map((l) => ({ final_label: l, predicted_label: l, count: counts[l] })).filter((r) => r.count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Synthetic vs live row counts (dashboard "Data sources" panel). */
async function dataSources() {
  const count = (table) =>
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE data_source = 'synthetic')::int AS synthetic,
              COUNT(*) FILTER (WHERE data_source = 'live')::int AS live
              ${table === "students" ? "" : ", COUNT(*) FILTER (WHERE upload_id IS NOT NULL)::int AS from_uploads"}
       FROM ${table}`
    );
  const [students, results, attendance, performance, uploads, withLive] = await Promise.all([
    count("students"),
    count("course_results"),
    count("attendance"),
    count("student_semester_performance"),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'committed')::int AS committed,
              COUNT(*) FILTER (WHERE status = 'committed' AND kind = 'cohort')::int AS cohorts,
              MAX(committed_at) AS last_committed_at
       FROM uploads`
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM students s WHERE ${HAS_LIVE_DATA}`),
  ]);
  return {
    students: students.rows[0],
    students_with_live_data: withLive.rows[0].n,
    course_results: results.rows[0],
    attendance: attendance.rows[0],
    performance: performance.rows[0],
    uploads: uploads.rows[0],
  };
}

// ---------------- USER PROVISIONING (admin issues email + password) ----------------

/** POST /api/admin/users/student - create a student account */
async function createStudentUser(req, res) {
  try {
    const { email, full_name, roll_no, department_id, gender, age, current_semester } = req.body;
    if (!email || !full_name || !roll_no || !department_id) {
      return res.status(400).json({ error: "Email, full name, roll no, and department are required" });
    }
    const tempPassword = randomPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (email, password_hash, role, must_reset_pw) VALUES ($1,$2,'student',TRUE) RETURNING user_id`,
        [email.toLowerCase().trim(), hash]
      );
      const s = await client.query(
        `INSERT INTO students (user_id, roll_no, full_name, department_id, gender, age, current_semester)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [u.rows[0].user_id, roll_no, full_name, department_id, gender, age, current_semester || 1]
      );
      await client.query("COMMIT");
      await logAction(req.user.userId, "CREATE_STUDENT", "students", s.rows[0].student_id, { email });
      res.status(201).json({ student: s.rows[0], tempPassword }); // shown once to admin to hand to student
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505") {
        // unique_violation - tell the admin exactly which field collided instead of a raw 500
        const field = e.constraint?.includes("email") ? "email" : e.constraint?.includes("roll_no") ? "roll no" : "a unique field";
        return res.status(409).json({ error: `That ${field} is already in use.` });
      }
      if (e.code === "23503") {
        return res.status(400).json({ error: "Invalid department selected." });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/admin/users/faculty - create a faculty account */
async function createFacultyUser(req, res) {
  try {
    const { email, full_name, employee_no, department_id, designation } = req.body;
    if (!email || !full_name || !employee_no || !department_id) {
      return res.status(400).json({ error: "Email, full name, employee no, and department are required" });
    }
    const tempPassword = randomPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query(
        `INSERT INTO users (email, password_hash, role, must_reset_pw) VALUES ($1,$2,'faculty',TRUE) RETURNING user_id`,
        [email.toLowerCase().trim(), hash]
      );
      const f = await client.query(
        `INSERT INTO faculty (user_id, employee_no, full_name, department_id, designation)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [u.rows[0].user_id, employee_no, full_name, department_id, designation]
      );
      await client.query("COMMIT");
      await logAction(req.user.userId, "CREATE_FACULTY", "faculty", f.rows[0].faculty_id, { email });
      res.status(201).json({ faculty: f.rows[0], tempPassword });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code === "23505") {
        const field = e.constraint?.includes("email") ? "email" : e.constraint?.includes("employee_no") ? "employee no" : "a unique field";
        return res.status(409).json({ error: `That ${field} is already in use.` });
      }
      if (e.code === "23503") {
        return res.status(400).json({ error: "Invalid department selected." });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Deactivate / reactivate: controllers/governanceController.js

// ---------------- DIRECTORY VIEWS (admin sees everything) ----------------

/** GET /api/admin/students?search=&page=1&limit=25
 *  Paginated + searchable - loading all 50,000 rows at once is what was
 *  making this page (and the browser tab) slow/unresponsive. */
async function listStudents(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();

    const params = [];
    let whereClause = "";
    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE s.roll_no ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM students s JOIN users u ON u.user_id = s.user_id ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT s.student_id, s.roll_no, s.full_name, d.name AS department, s.current_semester,
              s.cgpa, s.scholarship, s.hostel, u.user_id, u.email, u.is_active
       FROM students s
       JOIN departments d ON d.department_id = s.department_id
       JOIN users u ON u.user_id = s.user_id
       ${whereClause}
       ORDER BY s.roll_no
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/faculty */
async function listFaculty(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT f.faculty_id, f.employee_no, f.full_name, d.name AS department, f.designation,
              u.user_id, u.email, u.is_active,
              (SELECT COUNT(*) FROM faculty_courses fc WHERE fc.faculty_id = f.faculty_id) AS classes_taught
       FROM faculty f
       JOIN departments d ON d.department_id = f.department_id
       JOIN users u ON u.user_id = f.user_id
       ORDER BY f.full_name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/students/:studentId/full - complete profile incl. history + predictions (read-only) */
async function studentFullProfile(req, res) {
  try {
    const id = parseInt(req.params.studentId);
    if (!(id > 0)) return res.status(400).json({ error: "studentId must be a positive integer" });
    const [profile, history, predictions, results, nextSteps, counselor] = await Promise.all([
      pool.query(
        `SELECT s.*, d.name AS department, u.email FROM students s
         JOIN departments d ON d.department_id = s.department_id
         JOIN users u ON u.user_id = s.user_id WHERE s.student_id = $1`,
        [id]
      ),
      // Explicit columns: the dataset's target_label (ground truth) must not be exposed
      pool.query(
        `SELECT performance_id, student_id, semester, attendance_percentage, assignment_avg, quiz_avg,
                midterm_marks, final_marks, study_hours_per_week, lms_login_count,
                assignment_submission_rate, previous_sgpa, sgpa, cgpa, consecutive_low_cgpa,
                failed_courses, credits_enrolled, credits_passed, warning_count, created_at
         FROM student_semester_performance WHERE student_id = $1 ORDER BY semester`,
        [id]
      ),
      pool.query(`SELECT * FROM predictions WHERE student_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(
        `SELECT c.course_code, c.title, cr.* FROM enrollments e
         JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
         JOIN courses c ON c.course_id = fc.course_id
         LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
         WHERE e.student_id = $1`,
        [id]
      ),
      getNextSteps(id, { audience: "staff" }),
      getActiveCounselor(id),
    ]);
    if (!profile.rows.length) return res.status(404).json({ error: "Student not found" });
    res.json({
      profile: profile.rows[0],
      performanceHistory: history.rows,
      predictions: predictions.rows.map((p) => ({ ...p, reasons: staffReasons(p) })),
      courseResults: results.rows,
      nextSteps: nextSteps.map((s) => ({ id: s.id, text: s.text })), // staff wording
      counselor,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------- COURSE / FACULTY ASSIGNMENT ----------------

/** GET /api/admin/courses - all courses, for dropdowns and reference */
async function listCourses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT c.course_id, c.course_code, c.title, c.credit_hours, d.name AS department
       FROM courses c JOIN departments d ON d.department_id = c.department_id
       ORDER BY c.course_code`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/faculty-courses - every class section that exists, for dropdowns and reference */
async function listClasses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT fc.faculty_course_id, c.course_code, c.title, fc.section, fc.semester, fc.academic_year,
              f.full_name AS faculty_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.faculty_course_id = fc.faculty_course_id AND e.status = 'enrolled') AS enrolled_count
       FROM faculty_courses fc
       JOIN courses c ON c.course_id = fc.course_id
       JOIN faculty f ON f.faculty_id = fc.faculty_id
       ORDER BY c.course_code, fc.section`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/admin/enrollments?page&limit&search&status -> {rows, total, page, limit, totalPages}
 * Newest first, server-paginated (limit <= 100, default 25; it used to return only the latest 300).
 * search: roll no, student name or course code (case-insensitive); status: enrolled | dropped | completed.
 */
async function listEnrollments(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const where = [];
    const params = [];
    const search = String(req.query.search || "").trim();
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      where.push(`(s.roll_no ILIKE $${n} OR s.full_name ILIKE $${n} OR c.course_code ILIKE $${n})`);
    }
    if (req.query.status) {
      if (!["enrolled", "dropped", "completed"].includes(req.query.status)) {
        return res.status(400).json({ error: "status must be enrolled, dropped or completed" });
      }
      params.push(req.query.status);
      where.push(`e.status = $${params.length}`);
    }
    const from = `FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN courses c ON c.course_id = fc.course_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    const [count, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total ${from}`, params),
      pool.query(
        `SELECT e.enrollment_id, e.status, s.roll_no, s.full_name AS student_name, c.course_code, fc.section
         ${from} ORDER BY e.enrollment_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
    ]);
    const total = count.rows[0].total;
    res.json({ rows: rows.rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/admin/courses */
async function createCourse(req, res) {
  try {
    const { course_code, title, department_id, credit_hours } = req.body;
    if (!course_code || !title || !department_id) {
      return res.status(400).json({ error: "Course code, title, and department are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO courses (course_code, title, department_id, credit_hours) VALUES ($1,$2,$3,$4) RETURNING *`,
      [course_code, title, department_id, credit_hours || 3]
    );
    await logAction(req.user.userId, "CREATE_COURSE", "courses", rows[0].course_id, {});
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That course code already exists." });
    if (err.code === "23503") return res.status(400).json({ error: "Invalid department selected." });
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/admin/faculty-courses - assign a faculty member to teach a course/section */
async function assignFacultyToCourse(req, res) {
  try {
    const { faculty_id, course_id, section, semester, academic_year } = req.body;
    if (!faculty_id || !course_id || !semester || !academic_year) {
      return res.status(400).json({ error: "Faculty, course, semester, and academic year are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO faculty_courses (faculty_id, course_id, section, semester, academic_year, assigned_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [faculty_id, course_id, section || "A", semester, academic_year, req.user.userId]
    );
    await logAction(req.user.userId, "ASSIGN_FACULTY", "faculty_courses", rows[0].faculty_course_id, {});
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That faculty member is already assigned to this exact course/section/semester." });
    if (err.code === "23503") return res.status(400).json({ error: "Invalid faculty or course selected." });
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/admin/faculty-courses/:id - delete (unassign) a class section.
 * Only an EMPTY class can be deleted: deleting a class cascades through its enrollments to their
 * marks and attendance, so a class with any enrollment (enrolled or dropped) -> 409. Unknown -> 404.
 * The class row is locked first, so an enrollment can't be added between the check and the delete.
 */
async function unassignFacultyFromCourse(req, res) {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cls = await client.query(
      `SELECT fc.faculty_course_id, fc.section, c.course_code FROM faculty_courses fc
       JOIN courses c ON c.course_id = fc.course_id WHERE fc.faculty_course_id = $1 FOR UPDATE OF fc`,
      [id]
    );
    if (!cls.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Class not found" });
    }
    const { course_code, section } = cls.rows[0];
    const { rows: [n] } = await client.query("SELECT COUNT(*)::int AS total FROM enrollments WHERE faculty_course_id = $1", [id]);
    if (n.total > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          `${course_code} section ${section} can't be deleted: it has ${n.total} student${n.total === 1 ? "" : "s"} (enrolled or dropped), ` +
          "and deleting it would erase their marks and attendance. Only an empty class can be deleted.",
      });
    }
    await client.query("DELETE FROM faculty_courses WHERE faculty_course_id = $1", [id]);
    await client.query("COMMIT");
    await logAction(req.user.userId, "UNASSIGN_FACULTY", "faculty_courses", id, { course_code, section });
    res.json({ message: "Class deleted" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Could not delete the class" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/admin/enrollments - assign a student into a class (course assigning).
 * UNIQUE (student_id, faculty_course_id) keeps one row per student and class, so re-enrolling a
 * student who DROPPED the class sets that row back to 'enrolled' (its marks and attendance are kept)
 * -> 201 with `reenrolled: true`. Already enrolled (or completed) -> 409.
 */
async function enrollStudent(req, res) {
  try {
    const { student_id, faculty_course_id } = req.body;
    if (!student_id || !faculty_course_id) {
      return res.status(400).json({ error: "Student and class are both required" });
    }
    // xmax = 0 only for a freshly inserted row, so it tells a new enrollment from a re-enrollment
    const { rows } = await pool.query(
      `INSERT INTO enrollments (student_id, faculty_course_id, enrolled_by) VALUES ($1,$2,$3)
       ON CONFLICT (student_id, faculty_course_id) DO UPDATE SET status = 'enrolled', enrolled_by = EXCLUDED.enrolled_by
         WHERE enrollments.status = 'dropped'
       RETURNING *, (xmax <> 0) AS reenrolled`,
      [student_id, faculty_course_id, req.user.userId]
    );
    if (!rows.length) return res.status(409).json({ error: "This student is already enrolled in that class." });
    const { reenrolled, ...enrollment } = rows[0];
    await logAction(req.user.userId, "ENROLL_STUDENT", "enrollments", enrollment.enrollment_id, reenrolled ? { reenrolled: true } : {});
    res.status(201).json({ ...enrollment, reenrolled });
  } catch (err) {
    if (err.code === "23503") return res.status(400).json({ error: "Invalid student or class selected." });
    console.error(err);
    res.status(500).json({ error: "Could not enroll the student" });
  }
}

/** PUT /api/admin/enrollments/:id/drop - course dropping */
async function dropEnrollment(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE enrollments SET status = 'dropped' WHERE enrollment_id = $1 RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Enrollment not found" });
    await logAction(req.user.userId, "DROP_COURSE", "enrollments", req.params.id, {});
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------- CLASS RECORDS (read-only for admin - cannot edit results/attendance) ----------------

/** GET /api/admin/class-records/:facultyCourseId */
async function classRecords(req, res) {
  try {
    const fcId = req.params.facultyCourseId;
    const [roster, attendanceRows] = await Promise.all([
      pool.query(
        `SELECT s.roll_no, s.full_name, cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks, cr.grade
         FROM enrollments e JOIN students s ON s.student_id = e.student_id
         LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
         WHERE e.faculty_course_id = $1 ORDER BY s.roll_no`,
        [fcId]
      ),
      pool.query(
        `SELECT s.roll_no, a.class_date, a.status
         FROM attendance a JOIN enrollments e ON e.enrollment_id = a.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         WHERE e.faculty_course_id = $1 ORDER BY a.class_date DESC`,
        [fcId]
      ),
    ]);
    res.json({ results: roster.rows, attendance: attendanceRows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------- INTERVENTION NOTIFICATIONS ----------------

/**
 * POST /api/admin/notifications {recipient_user_id, subject, message, related_prediction_id?, includeTutorial?}
 * To a student: {name}/{course}/{counselor} are filled in and, with includeTutorial (default: true
 * when the student is At-Risk or Dropout-Likely), one line with their recommended tutorial is added.
 * To a faculty member: sent as written. Returns the row plus unknownPlaceholders.
 */
async function sendNotification(req, res) {
  try {
    const { recipient_user_id, subject, message, related_prediction_id, includeTutorial } = req.body;
    const st = await pool.query("SELECT student_id FROM students WHERE user_id = $1", [recipient_user_id]);
    if (st.rows.length) {
      const out = await interventions.sendInterventions([st.rows[0].student_id], { subject, message, includeTutorial, sender: req.user.userId });
      const n = out.notifications[0];
      await logAction(req.user.userId, "SEND_NOTIFICATION", "notifications", n.notification_id, {
        roll_no: n.roll_no,
        related_tutorial_id: n.related_tutorial_id,
      });
      const { rows } = await pool.query("SELECT * FROM notifications WHERE notification_id = $1", [n.notification_id]);
      return res.status(201).json({ ...rows[0], unknownPlaceholders: out.unknownPlaceholders });
    }
    const { rows } = await pool.query(
      `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message, related_prediction_id, kind)
       VALUES ($1,$2,$3,$4,$5,'intervention') RETURNING *`,
      [req.user.userId, recipient_user_id, subject, message, related_prediction_id || null]
    );
    await logAction(req.user.userId, "SEND_NOTIFICATION", "notifications", rows[0].notification_id, {});
    res.status(201).json({ ...rows[0], unknownPlaceholders: [] });
  } catch (err) {
    if (err.code === "23503") return res.status(400).json({ error: "Unknown recipient" });
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/admin/notifications/bulk {studentIds | filter, subject, message, includeTutorial?}
 * At most 500 students per call: more studentIds -> 400; a filter matching more sends to the
 * first 500 (most severe first) and says so. Returns {sent, matched, capped, unknownPlaceholders}.
 * The filter takes the at-risk list filters (label, department, semester, search, noCounselor, notContacted).
 */
async function bulkNotify(req, res) {
  try {
    const { studentIds, filter, subject, message, includeTutorial } = req.body;
    let ids;
    let matched;
    if (Array.isArray(studentIds)) {
      if (studentIds.length > interventions.MAX_BULK) {
        return res.status(400).json({ error: `At most ${interventions.MAX_BULK} students per call` });
      }
      ids = studentIds;
      matched = ids.length;
    } else {
      const { where, params } = latestFilters(filter || {}, { riskOnly: true });
      const from = `FROM students s JOIN users u ON u.user_id = s.user_id
        JOIN predictions p ON p.prediction_id = s.latest_prediction_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
      const [count, rows] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS n ${from}`, params),
        pool.query(
          `SELECT s.student_id ${from}
           ORDER BY CASE p.final_label WHEN 'Dropout-Likely' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END, s.roll_no
           LIMIT ${interventions.MAX_BULK}`,
          params
        ),
      ]);
      matched = count.rows[0].n;
      ids = rows.rows.map((r) => r.student_id);
    }
    const out = await interventions.sendInterventions(ids, { subject, message, includeTutorial, sender: req.user.userId });
    await logAction(req.user.userId, "BULK_NOTIFY", "notifications", null, {
      sent: out.sent,
      matched,
      subject,
      include_tutorial: includeTutorial ?? "default",
      filter: Array.isArray(studentIds) ? undefined : filter || {},
      student_ids: Array.isArray(studentIds) ? ids.slice(0, 50) : undefined,
      notification_ids: out.notifications.slice(0, 50).map((n) => n.notification_id),
    });
    res.status(201).json({
      sent: out.sent,
      matched,
      capped: matched > ids.length,
      skipped: out.skipped,
      unknownPlaceholders: out.unknownPlaceholders,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/admin/notifications/preview {studentId, subject, message, includeTutorial?} -> one filled-in message (not sent) */
async function previewNotification(req, res) {
  try {
    const { studentId, subject, message, includeTutorial } = req.body;
    const st = await interventions.studentInfo(studentId);
    if (!st) return res.status(404).json({ error: "Student not found" });
    const c = interventions.compose(st, { subject, message, includeTutorial });
    res.json({
      roll_no: st.roll_no,
      full_name: st.full_name,
      subject: c.subject,
      message: c.message,
      related_tutorial_id: c.tutorial_id,
      unknownPlaceholders: c.unknown,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/at-risk-students - students whose LATEST final label is At-Risk or
 *  Dropout-Likely. Paginated and filterable (see latestPredictionPage). */
async function atRiskStudents(req, res) {
  try {
    res.json(await latestPredictionPage(req, { riskOnly: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/predictions - every student's LATEST prediction, one row per student with
 *  their current course codes. Paginated and filterable (see latestPredictionPage). */
async function predictionsDetailed(req, res) {
  try {
    res.json(await latestPredictionPage(req, { withCourses: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------- BATCH PREDICTION RUNS ----------------

/** POST /api/admin/predictions/run {scope: "all" | "department" | "class", scopeId}
 *  Starts a background run and returns its id immediately (202). */
async function runPredictions(req, res) {
  try {
    const { scope, scopeId } = req.body;
    const run = await startRun({ scope, scopeId, startedBy: req.user.userId });
    await logAction(req.user.userId, "RUN_PREDICTIONS", "prediction_runs", run.id, { scope, scopeId, total: run.total });
    res.status(202).json(run);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** GET /api/admin/predictions/runs?limit=20 - recent runs, newest first */
async function listPredictionRuns(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { rows } = await pool.query(
      `SELECT r.*, u.email AS started_by_email,
              CASE r.scope WHEN 'department' THEN d.name
                           WHEN 'class' THEN c.course_code || ' ' || fc.section
                           ELSE 'All students' END AS scope_name,
              EXTRACT(EPOCH FROM (COALESCE(r.finished_at, NOW()) - r.started_at))::int AS duration_seconds
       FROM prediction_runs r
       LEFT JOIN users u ON u.user_id = r.started_by
       LEFT JOIN departments d ON r.scope = 'department' AND d.department_id = r.scope_id
       LEFT JOIN faculty_courses fc ON r.scope = 'class' AND fc.faculty_course_id = r.scope_id
       LEFT JOIN courses c ON c.course_id = fc.course_id
       ORDER BY r.started_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/admin/predictions/runs/:id - progress of a run */
async function getPredictionRun(req, res) {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  dashboard, listDepartments, createStudentUser, createFacultyUser,
  listStudents, listFaculty, studentFullProfile,
  listCourses, listClasses, listEnrollments,
  createCourse, assignFacultyToCourse, unassignFacultyFromCourse,
  enrollStudent, dropEnrollment, classRecords,
  sendNotification, bulkNotify, previewNotification, latestFilters, atRiskStudents, predictionsDetailed,
  runPredictions, getPredictionRun, listPredictionRuns,
};
