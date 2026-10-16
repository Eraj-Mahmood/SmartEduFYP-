const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { startRun, getRun } = require("../services/predictionRuns");

// Latest prediction per student (uses idx_predictions_student_latest)
const LATEST_PREDICTIONS = `SELECT DISTINCT ON (student_id) * FROM predictions
         ORDER BY student_id, created_at DESC, prediction_id DESC`;

const LABELS = ["Safe", "At-Risk", "Dropout-Likely"];
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
async function latestPredictionPage(req, { riskOnly = false, withCourses = false } = {}) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\?/g, `$${params.length}`)); // every ? in one condition is the same value
  };
  if (riskOnly) where.push("p.final_label IN ('At-Risk', 'Dropout-Likely')");
  if (req.query.label && LABELS.includes(req.query.label)) add("p.final_label = ?", req.query.label);
  if (parseInt(req.query.department)) add("s.department_id = ?", parseInt(req.query.department));
  if (parseInt(req.query.semester)) add("s.current_semester = ?", parseInt(req.query.semester));
  const search = (req.query.search || "").trim();
  if (search) add("(s.roll_no ILIKE ? OR s.full_name ILIKE ? OR u.email ILIKE ?)", `%${search}%`);
  const order = SORTS[req.query.sort] || SORTS.severity;

  const base = `
    WITH latest AS (
      SELECT DISTINCT ON (student_id) student_id, prediction_id, final_label, prob_dropout, reasons,
             policy_reason, source, created_at, (features->>'CGPA')::numeric AS projected_cgpa
      FROM predictions ORDER BY student_id, created_at DESC, prediction_id DESC
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
       SELECT p.*, p.final_label AS predicted_label${
         withCourses
           ? `, (SELECT COALESCE(array_agg(c.course_code ORDER BY c.course_code), '{}')
                FROM enrollments e
                JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
                JOIN courses c ON c.course_id = fc.course_id
                WHERE e.student_id = p.student_id AND e.status = 'enrolled') AS courses`
           : ""
       }
       FROM pg p ORDER BY ${order}`,
      [...params, limit, (page - 1) * limit]
    ),
  ]);
  const total = count.rows[0].total;
  return { rows: rows.rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

function randomPassword() {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + "!1";
}

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
    const [students, faculty, courses, risk, byDept, lastRun, runs] = await Promise.all([
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

/** PUT /api/admin/users/:userId/deactivate */
async function deactivateUser(req, res) {
  try {
    await pool.query("UPDATE users SET is_active = FALSE WHERE user_id = $1", [req.params.userId]);
    await logAction(req.user.userId, "DEACTIVATE_USER", "users", req.params.userId, {});
    res.json({ message: "User deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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
              s.cgpa, s.scholarship, s.hostel, u.email, u.is_active
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
              u.email, u.is_active,
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
    const id = req.params.studentId;
    const [profile, history, predictions, results] = await Promise.all([
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
    ]);
    res.json({
      profile: profile.rows[0],
      performanceHistory: history.rows,
      predictions: predictions.rows,
      courseResults: results.rows,
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

/** GET /api/admin/enrollments - every enrollment that exists, for dropdowns and reference */
async function listEnrollments(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT e.enrollment_id, e.status, s.roll_no, s.full_name AS student_name,
              c.course_code, fc.section
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN courses c ON c.course_id = fc.course_id
       ORDER BY e.enrollment_id DESC
       LIMIT 300`
    );
    res.json(rows);
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

/** DELETE /api/admin/faculty-courses/:id - unassign faculty from a class */
async function unassignFacultyFromCourse(req, res) {
  try {
    await pool.query("DELETE FROM faculty_courses WHERE faculty_course_id = $1", [req.params.id]);
    await logAction(req.user.userId, "UNASSIGN_FACULTY", "faculty_courses", req.params.id, {});
    res.json({ message: "Unassigned" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/admin/enrollments - assign a student into a class (course assigning) */
async function enrollStudent(req, res) {
  try {
    const { student_id, faculty_course_id } = req.body;
    if (!student_id || !faculty_course_id) {
      return res.status(400).json({ error: "Student and class are both required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO enrollments (student_id, faculty_course_id, enrolled_by) VALUES ($1,$2,$3) RETURNING *`,
      [student_id, faculty_course_id, req.user.userId]
    );
    await logAction(req.user.userId, "ENROLL_STUDENT", "enrollments", rows[0].enrollment_id, {});
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "This student is already enrolled in that class." });
    if (err.code === "23503") return res.status(400).json({ error: "Invalid student or class selected." });
    res.status(500).json({ error: err.message });
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

/** POST /api/admin/notifications - send to a student or faculty, optionally linked to a prediction */
async function sendNotification(req, res) {
  try {
    const { recipient_user_id, subject, message, related_prediction_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message, related_prediction_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.userId, recipient_user_id, subject, message, related_prediction_id || null]
    );
    await logAction(req.user.userId, "SEND_NOTIFICATION", "notifications", rows[0].notification_id, {});
    res.status(201).json(rows[0]);
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
  dashboard, listDepartments, createStudentUser, createFacultyUser, deactivateUser,
  listStudents, listFaculty, studentFullProfile,
  listCourses, listClasses, listEnrollments,
  createCourse, assignFacultyToCourse, unassignFacultyFromCourse,
  enrollStudent, dropEnrollment, classRecords,
  sendNotification, atRiskStudents, predictionsDetailed,
  runPredictions, getPredictionRun, listPredictionRuns,
};
