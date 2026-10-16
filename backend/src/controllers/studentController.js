const pool = require("../config/db");
const { predictForStudent } = require("../services/predictionService");

// What a student may see of a prediction: labels, probabilities and plain-language reasons.
// Never the SHAP drivers (raw numbers) or the full feature vector.
const STUDENT_PREDICTION_COLUMNS = `prediction_id, semester, predicted_label, final_label, model_label, policy_label,
       policy_reason, reasons, prob_safe, prob_at_risk, prob_dropout, model_version, source,
       feature_sources, created_at`;

// Every query here is scoped by req.user.userId -> students.user_id.
// Students have NO write routes in this file - read-only by design.

async function getMyStudentId(userId) {
  const { rows } = await pool.query("SELECT student_id FROM students WHERE user_id = $1", [userId]);
  if (rows.length === 0) throw new Error("Student profile not found");
  return rows[0].student_id;
}

/** GET /api/student/dashboard */
async function dashboard(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const student = await pool.query(
      `SELECT s.student_id, s.roll_no, s.full_name, s.current_semester, s.cgpa,
              s.scholarship, s.hostel, d.name AS department
       FROM students s JOIN departments d ON d.department_id = s.department_id
       WHERE s.student_id = $1`,
      [studentId]
    );

    const latestPrediction = await pool.query(
      `SELECT ${STUDENT_PREDICTION_COLUMNS}
       FROM predictions WHERE student_id = $1 ORDER BY created_at DESC, prediction_id DESC LIMIT 1`,
      [studentId]
    );

    const attendanceAvg = await pool.query(
      `SELECT AVG(attendance_percentage)::numeric(5,2) AS avg_attendance
       FROM student_semester_performance WHERE student_id = $1`,
      [studentId]
    );

    res.json({
      profile: student.rows[0],
      latestPrediction: latestPrediction.rows[0] || null,
      averageAttendance: attendanceAvg.rows[0].avg_attendance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/student/results - per-course results across all enrollments */
async function results(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const { rows } = await pool.query(
      `SELECT c.course_code, c.title, fc.semester, fc.academic_year,
              cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks, cr.grade,
              e.status
       FROM enrollments e
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN courses c ON c.course_id = fc.course_id
       LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
       WHERE e.student_id = $1
       ORDER BY fc.academic_year DESC, fc.semester DESC`,
      [studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/student/attendance - per-course attendance summary */
async function attendance(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const { rows } = await pool.query(
      `SELECT c.course_code, c.title,
              COUNT(*) FILTER (WHERE a.status = 'present') AS present_count,
              COUNT(*) AS total_classes,
              ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present') / NULLIF(COUNT(*),0), 2) AS attendance_pct
       FROM enrollments e
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN courses c ON c.course_id = fc.course_id
       JOIN attendance a ON a.enrollment_id = e.enrollment_id
       WHERE e.student_id = $1
       GROUP BY c.course_code, c.title`,
      [studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/student/history - full semester-by-semester CGPA/SGPA trend for charts */
async function history(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const { rows } = await pool.query(
      `SELECT semester, sgpa, cgpa, attendance_percentage, failed_courses, warning_count
       FROM student_semester_performance WHERE student_id = $1 ORDER BY semester`,
      [studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/student/prediction
 * The "helper bot": returns the most recent prediction. If none exists yet,
 * calls the ML microservice live using the student's latest performance row.
 */
async function prediction(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);

    const existing = await pool.query(
      `SELECT ${STUDENT_PREDICTION_COLUMNS}
       FROM predictions WHERE student_id = $1 ORDER BY created_at DESC, prediction_id DESC LIMIT 1`,
      [studentId]
    );
    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }
    return res.json({ message: "No prediction yet. POST /api/student/prediction/refresh to generate one." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/student/prediction/refresh - re-run the prediction on the latest data.
 * Features are built from live marks/attendance (services/featureBuilder), scored by the
 * ML service with a rule fallback, checked by the policy layer, and explained in plain language.
 */
async function refreshPrediction(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const row = await predictForStudent(studentId, { trigger: "student_refresh" });
    const { drivers, features, ...studentView } = row; // never send SHAP numbers to students
    res.json(studentView);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { dashboard, results, attendance, history, prediction, refreshPrediction };
