const pool = require("../config/db");
// Node 18+ has global fetch - no extra dependency needed to call the ML microservice.

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
      `SELECT predicted_label, prob_safe, prob_at_risk, prob_dropout, semester, created_at
       FROM predictions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
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
      `SELECT * FROM predictions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
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
 * POST /api/student/prediction/refresh - re-run the model on latest data
 *
 * The trained pipeline (see ml_service/) expects EXACTLY these 20 raw fields,
 * with these exact names/casing (it does its own imputation + one-hot
 * encoding internally, so we just hand it the raw values):
 *   Semester, Department, Gender, Age, Attendance_Percentage, Assignment_Avg,
 *   Quiz_Avg, Midterm_Marks, Final_Marks, Study_Hours_Per_Week, LMS_Login_Count,
 *   Assignment_Submission_Rate, Previous_SGPA, SGPA, CGPA, Failed_Courses,
 *   Credits_Enrolled, Credits_Passed, Scholarship, Hostel
 * Department/Gender/Scholarship/Hostel must be sent as strings (not IDs),
 * matching the training data exactly (e.g. "CS", "Male", "Yes").
 */
async function refreshPrediction(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);

    const latest = await pool.query(
      `SELECT p.*, s.gender, s.age, s.scholarship, s.hostel, d.code AS department_code
       FROM student_semester_performance p
       JOIN students s ON s.student_id = p.student_id
       JOIN departments d ON d.department_id = s.department_id
       WHERE p.student_id = $1
       ORDER BY p.semester DESC LIMIT 1`,
      [studentId]
    );
    if (latest.rows.length === 0) {
      return res.status(404).json({ error: "No performance history to predict from yet" });
    }
    const r = latest.rows[0];

    const modelFeatures = {
      Semester: r.semester,
      Department: r.department_code,
      Gender: r.gender,
      Age: r.age,
      Attendance_Percentage: Number(r.attendance_percentage),
      Assignment_Avg: Number(r.assignment_avg),
      Quiz_Avg: Number(r.quiz_avg),
      Midterm_Marks: Number(r.midterm_marks),
      Final_Marks: Number(r.final_marks),
      Study_Hours_Per_Week: Number(r.study_hours_per_week),
      LMS_Login_Count: r.lms_login_count,
      Assignment_Submission_Rate: Number(r.assignment_submission_rate),
      Previous_SGPA: Number(r.previous_sgpa),
      SGPA: Number(r.sgpa),
      CGPA: Number(r.cgpa),
      Failed_Courses: r.failed_courses,
      Credits_Enrolled: r.credits_enrolled,
      Credits_Passed: r.credits_passed,
      Scholarship: r.scholarship,
      Hostel: r.hostel,
    };

    // Calls the FastAPI microservice that wraps YOUR trained Random Forest
    // pipeline (ml_service/app.py + smartedu_random_forest_version_a.pkl).
    // Falls back to a rule-based estimate if the ML service isn't running,
    // so the demo never hard-fails while you're setting it up.
    let predicted;
    try {
      const mlResponse = await fetch(process.env.ML_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: modelFeatures }),
      });
      if (!mlResponse.ok) {
        const errBody = await mlResponse.text();
        throw new Error(`ML service responded ${mlResponse.status}: ${errBody}`);
      }
      predicted = await mlResponse.json(); // { label, prob_safe, prob_at_risk, prob_dropout, model_version }
    } catch (mlErr) {
      console.warn("ML service unreachable, using rule-based fallback:", mlErr.message);
      predicted = ruleBasedFallback(r);
    }

    const inserted = await pool.query(
      `INSERT INTO predictions (student_id, semester, predicted_label, prob_safe, prob_at_risk, prob_dropout, model_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        studentId, r.semester, predicted.label,
        predicted.prob_safe, predicted.prob_at_risk, predicted.prob_dropout,
        predicted.model_version || "fallback_v1",
      ]
    );

    res.json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/** Simple transparent fallback so the app still works if the Python ML service is down/not built yet */
function ruleBasedFallback(f) {
  const cgpa = Number(f.cgpa);
  const warnings = Number(f.warning_count || 0);
  if (cgpa < 1.5 || warnings >= 3) {
    return { label: "Dropout-Likely", prob_safe: 0.05, prob_at_risk: 0.15, prob_dropout: 0.8, model_version: "rule_fallback" };
  }
  if (cgpa < 2.5 || warnings >= 1) {
    return { label: "At-Risk", prob_safe: 0.2, prob_at_risk: 0.6, prob_dropout: 0.2, model_version: "rule_fallback" };
  }
  return { label: "Safe", prob_safe: 0.85, prob_at_risk: 0.12, prob_dropout: 0.03, model_version: "rule_fallback" };
}

module.exports = { dashboard, results, attendance, history, prediction, refreshPrediction };
