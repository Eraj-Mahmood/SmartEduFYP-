const pool = require("../config/db");
const { thresholds: POLICY } = require("./policy");
const { getCourseSummary, PASS_MARK, round2 } = require("./studentCourses");
const { toReasons } = require("./reasons");

// One student's overview: official (imported) and this term's live/projected figures side by
// side, each with a label and source, plus the latest prediction and this term's courses.
// Used by GET /api/student/dashboard and the chat context. Never includes probabilities,
// SHAP drivers or the feature vector.

/** getStudentOverview(studentId) -> the GET /api/student/dashboard payload. */
async function getStudentOverview(studentId, db = pool) {
  const [student, perf, latest, summary] = await Promise.all([
    db.query(
      `SELECT s.student_id, s.roll_no, s.full_name, s.current_semester, s.cgpa,
              s.scholarship, s.hostel, d.name AS department, d.code AS department_code
       FROM students s JOIN departments d ON d.department_id = s.department_id
       WHERE s.student_id = $1`,
      [studentId]
    ),
    db.query(
      `SELECT semester, cgpa, sgpa, previous_sgpa, attendance_percentage
       FROM student_semester_performance WHERE student_id = $1 ORDER BY semester DESC LIMIT 1`,
      [studentId]
    ),
    // latest prediction via the students.latest_prediction_id pointer
    db.query(
      `SELECT p.prediction_id, p.predicted_label, p.final_label, p.policy_reason, p.reasons,
              p.drivers, p.features, p.source, p.feature_sources, p.created_at,
              (p.features->>'CGPA')::numeric AS projected_cgpa,
              (p.features->>'SGPA')::numeric AS provisional_sgpa,
              (p.features->>'Previous_SGPA')::numeric AS previous_sgpa,
              -- when the current label started: the first prediction after the last one with a different label
              (SELECT MIN(q.created_at) FROM predictions q
               WHERE q.student_id = p.student_id
                 AND q.prediction_id > COALESCE((SELECT MAX(r.prediction_id) FROM predictions r
                                                 WHERE r.student_id = p.student_id AND r.final_label <> p.final_label), 0)
              ) AS status_since,
              EXISTS (SELECT 1 FROM predictions r WHERE r.student_id = p.student_id AND r.final_label <> p.final_label)
                AS label_ever_changed
       FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       WHERE s.student_id = $1`,
      [studentId]
    ),
    getCourseSummary(studentId, db),
  ]);
  if (student.rows.length === 0) throw Object.assign(new Error("Student profile not found"), { status: 404 });

  const p = perf.rows[0] || {};
  const pred = latest.rows[0] || null;
  const src = (pred && pred.feature_sources) || {};
  const { courses, weakest, present, sessions } = summary;

  return {
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
      // rebuilt from the stored drivers/features so the wording is always current
      // (some stored rows predate the Phase 2 severity-cap fix)
      reasons: pred.features ? toReasons(pred.drivers, pred.features, pred.final_label) : pred.reasons || [],
      policy_reason: pred.policy_reason,
      source: pred.source,
      created_at: pred.created_at,
      status_since: pred.status_since,
      label_ever_changed: pred.label_ever_changed,
    },
    weakestCourse: weakest && { course_code: weakest.course_code, title: weakest.title, mean: weakest.mean },
    courses,
    coursesBelowPassMark: courses.filter((c) => c.below_pass_mark).length,
    thresholds: {
      pass_mark: PASS_MARK,
      probation_cgpa: POLICY.probation_cgpa,
      at_risk_cgpa: POLICY.at_risk_cgpa,
      min_attendance_pct: POLICY.min_attendance_pct,
      severe_attendance_pct: POLICY.severe_attendance_pct,
    },
  };
}

module.exports = { getStudentOverview };
