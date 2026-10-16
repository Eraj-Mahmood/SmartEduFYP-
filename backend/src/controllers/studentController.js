const pool = require("../config/db");
const { predictForStudent } = require("../services/predictionService");
const { deriveGrade, overallMark, GRADE_THRESHOLDS } = require("../services/grading");
const { thresholds: POLICY } = require("../services/policy");

// What a student may see of a prediction: labels and plain-language reasons.
// Never probabilities, the SHAP drivers (raw numbers) or the full feature vector.
const STUDENT_PREDICTION_COLUMNS = `prediction_id, semester, predicted_label, final_label, policy_reason, reasons,
       source, feature_sources, created_at`;

// Lowest passing mark (grade D): a course below it counts as "at risk".
const PASS_MARK = GRADE_THRESHOLDS.find(([g]) => g === "D")[1];
const round2 = (x) => (x == null ? null : Math.round(Number(x) * 100) / 100);

// Every query here is scoped by req.user.userId -> students.user_id.
// Students have NO write routes in this file - read-only by design.

async function getMyStudentId(userId) {
  const { rows } = await pool.query("SELECT student_id FROM students WHERE user_id = $1", [userId]);
  if (rows.length === 0) throw new Error("Student profile not found");
  return rows[0].student_id;
}

/**
 * GET /api/student/dashboard
 * Official (imported) figures and this term's live/projected figures are returned side by
 * side, each with a label and source, so the UI never mixes them up.
 */
async function dashboard(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const [student, perf, latest, courses] = await Promise.all([
      pool.query(
        `SELECT s.student_id, s.roll_no, s.full_name, s.current_semester, s.cgpa,
                s.scholarship, s.hostel, d.name AS department, d.code AS department_code
         FROM students s JOIN departments d ON d.department_id = s.department_id
         WHERE s.student_id = $1`,
        [studentId]
      ),
      pool.query(
        `SELECT semester, cgpa, sgpa, previous_sgpa, attendance_percentage
         FROM student_semester_performance WHERE student_id = $1 ORDER BY semester DESC LIMIT 1`,
        [studentId]
      ),
      pool.query(
        `SELECT ${STUDENT_PREDICTION_COLUMNS},
                (features->>'CGPA')::numeric AS projected_cgpa,
                (features->>'SGPA')::numeric AS provisional_sgpa,
                (features->>'Previous_SGPA')::numeric AS previous_sgpa
         FROM predictions WHERE student_id = $1 ORDER BY created_at DESC, prediction_id DESC LIMIT 1`,
        [studentId]
      ),
      pool.query(
        `SELECT c.course_code, c.title, c.credit_hours, e.enrollment_id,
                cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks,
                COUNT(a.attendance_id) FILTER (WHERE a.status = 'present') AS present,
                COUNT(a.attendance_id) AS sessions
         FROM enrollments e
         JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
         JOIN courses c ON c.course_id = fc.course_id
         LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
         LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
         WHERE e.student_id = $1 AND e.status = 'enrolled'
         GROUP BY c.course_code, c.title, c.credit_hours, e.enrollment_id, cr.result_id
         ORDER BY c.course_code`,
        [studentId]
      ),
    ]);

    const p = perf.rows[0] || {};
    const pred = latest.rows[0] || null;
    const src = (pred && pred.feature_sources) || {};

    const courseRows = courses.rows.map((c) => {
      const hasMarks = c.assignment_avg != null;
      const marks = {
        assignment_avg: round2(c.assignment_avg),
        quiz_avg: round2(c.quiz_avg),
        midterm_marks: round2(c.midterm_marks),
        final_marks: round2(c.final_marks),
      };
      const mean = hasMarks ? round2(overallMark(marks)) : null;
      const sessions = Number(c.sessions);
      return {
        course_code: c.course_code,
        title: c.title,
        credit_hours: c.credit_hours,
        ...marks,
        mean,
        grade: hasMarks ? deriveGrade(marks) : null,
        below_pass_mark: hasMarks && mean < PASS_MARK,
        present: Number(c.present),
        sessions,
        attendance_pct: sessions > 0 ? round2((100 * Number(c.present)) / sessions) : null,
      };
    });
    const withMarks = courseRows.filter((c) => c.mean != null);
    const weakest = withMarks.length ? withMarks.reduce((w, c) => (c.mean < w.mean ? c : w)) : null;
    const present = courseRows.reduce((n, c) => n + c.present, 0);
    const sessions = courseRows.reduce((n, c) => n + c.sessions, 0);

    res.json({
      profile: student.rows[0],
      officialCgpa: {
        value: round2(p.cgpa != null ? p.cgpa : student.rows[0].cgpa),
        label: "Official CGPA",
        source: "imported",
        note: "From your academic record (last completed term).",
      },
      projectedCgpa: pred && {
        value: round2(pred.projected_cgpa),
        label: "Projected CGPA",
        source: src.CGPA === "projected" ? "projected" : "imported",
        note:
          src.CGPA === "projected"
            ? "What your CGPA would be if this term ended with today's marks."
            : "No marks entered this term yet, so this equals your official CGPA.",
      },
      provisionalSgpa: pred && {
        value: round2(pred.provisional_sgpa),
        label: "Provisional SGPA (this term)",
        source: src.SGPA === "provisional" ? "provisional" : "imported",
      },
      previousSgpa: pred && { value: round2(pred.previous_sgpa), label: "Previous SGPA", source: "imported" },
      liveAttendance:
        sessions > 0
          ? { value: round2((100 * present) / sessions), present, sessions, label: "Attendance this term", source: "live" }
          : { value: round2(p.attendance_percentage), label: "Attendance (record)", source: "imported" },
      latestPrediction: pred && {
        prediction_id: pred.prediction_id,
        final_label: pred.final_label,
        predicted_label: pred.predicted_label,
        reasons: pred.reasons || [],
        policy_reason: pred.policy_reason,
        source: pred.source,
        created_at: pred.created_at,
      },
      weakestCourse: weakest && { course_code: weakest.course_code, title: weakest.title, mean: weakest.mean },
      courses: courseRows,
      coursesBelowPassMark: courseRows.filter((c) => c.below_pass_mark).length,
      thresholds: {
        pass_mark: PASS_MARK,
        probation_cgpa: POLICY.probation_cgpa,
        at_risk_cgpa: POLICY.at_risk_cgpa,
        min_attendance_pct: POLICY.min_attendance_pct,
        severe_attendance_pct: POLICY.severe_attendance_pct,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/student/prediction/timeline
 * The student's predictions over the last 30 days, collapsed to the latest one per day.
 */
async function predictionTimeline(req, res) {
  try {
    const studentId = await getMyStudentId(req.user.userId);
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (created_at::date)
              created_at::date AS date, final_label, (features->>'CGPA')::numeric AS projected_cgpa
       FROM predictions
       WHERE student_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at::date, created_at DESC, prediction_id DESC`,
      [studentId]
    );
    res.json(rows.map((r) => ({ ...r, projected_cgpa: round2(r.projected_cgpa) })));
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
    // never send SHAP numbers, the feature vector or probabilities to students
    const { drivers, features, prob_safe, prob_at_risk, prob_dropout, model_label, policy_label, ...studentView } = row;
    res.json(studentView);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { dashboard, results, attendance, history, prediction, predictionTimeline, refreshPrediction };
