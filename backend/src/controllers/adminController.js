const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { startRun, getRun } = require("../services/predictionRuns");

// Latest prediction per student (uses idx_predictions_student_latest)
const LATEST_PREDICTIONS = `SELECT DISTINCT ON (student_id) * FROM predictions
         ORDER BY student_id, created_at DESC, prediction_id DESC`;

function listLimit(req) {
  return Math.min(5000, Math.max(1, parseInt(req.query.limit) || 500));
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

/** GET /api/admin/dashboard - top-level stats for the admin landing page */
async function dashboard(req, res) {
  try {
    const [students, faculty, courses, atRisk] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM students"),
      pool.query("SELECT COUNT(*) FROM faculty"),
      pool.query("SELECT COUNT(*) FROM courses"),
      // final_label is also returned as predicted_label, which the dashboard screen reads
      pool.query(
        `WITH latest AS (${LATEST_PREDICTIONS})
         SELECT final_label, final_label AS predicted_label, COUNT(*) FROM latest
         GROUP BY final_label
         ORDER BY CASE final_label WHEN 'Dropout-Likely' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END`
      ),
    ]);
    res.json({
      totalStudents: Number(students.rows[0].count),
      totalFaculty: Number(faculty.rows[0].count),
      totalCourses: Number(courses.rows[0].count),
      riskBreakdown: atRisk.rows,
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

/** GET /api/admin/at-risk-students?limit=500 - students whose LATEST final label is At-Risk or
 *  Dropout-Likely, most severe first. Limited because a full run flags tens of thousands. */
async function atRiskStudents(req, res) {
  try {
    const { rows } = await pool.query(
      `WITH latest AS (${LATEST_PREDICTIONS})
       SELECT s.student_id, s.roll_no, s.full_name, u.user_id, u.email, p.prediction_id,
              p.final_label AS predicted_label, p.final_label, p.policy_reason, p.reasons,
              p.prob_dropout, p.created_at
       FROM latest p
       JOIN students s ON s.student_id = p.student_id
       JOIN users u ON u.user_id = s.user_id
       WHERE p.final_label IN ('At-Risk', 'Dropout-Likely')
       ORDER BY CASE p.final_label WHEN 'Dropout-Likely' THEN 0 ELSE 1 END, p.prob_dropout DESC, p.created_at DESC
       LIMIT $1`,
      [listLimit(req)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/admin/predictions - every student's LATEST prediction, joined with
 * their current enrollments so you can see which enrollment_id/course/semester
 * it relates to. One row per (prediction, enrollment) pair - a student with
 * 4 classes shows up as 4 rows sharing the same prediction, one per course.
 * ?limit=500 caps the number of students (most recent predictions first).
 */
async function predictionsDetailed(req, res) {
  try {
    const { rows } = await pool.query(
      `WITH latest_predictions AS (
         SELECT * FROM (${LATEST_PREDICTIONS}) l
         ORDER BY created_at DESC, prediction_id DESC
         LIMIT $1
       )
       SELECT p.prediction_id, p.student_id, s.roll_no, s.full_name, p.semester AS prediction_semester,
              p.final_label AS predicted_label, p.final_label, p.model_label, p.policy_label, p.policy_reason, p.reasons,
              p.source, p.prob_safe, p.prob_at_risk, p.prob_dropout, p.created_at,
              e.enrollment_id, e.status AS enrollment_status, fc.semester AS class_semester,
              fc.section, c.course_code, c.title AS course_title
       FROM latest_predictions p
       JOIN students s ON s.student_id = p.student_id
       LEFT JOIN enrollments e ON e.student_id = p.student_id
       LEFT JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       LEFT JOIN courses c ON c.course_id = fc.course_id
       ORDER BY p.created_at DESC, s.roll_no, c.course_code`,
      [listLimit(req)]
    );
    res.json(rows);
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
  runPredictions, getPredictionRun,
};
