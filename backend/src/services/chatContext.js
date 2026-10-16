const pool = require("../config/db");
const { getStudentOverview } = require("./studentOverview");
const { getNextSteps } = require("./nextSteps");

// Everything the chat assistant may know about ONE student, as one small object.
// It is built from the same services as the dashboard, so the numbers always match.
// The caller passes the student id taken from the JWT (req.user), never from the request body.
// No probabilities, SHAP drivers or raw model features.

const MAX_INTERVENTIONS = 3;

/** buildChatContext(studentId) -> the chat context (see the shape below). */
async function buildChatContext(studentId, db = pool) {
  const [o, nextSteps, interventions, user] = await Promise.all([
    getStudentOverview(studentId, db),
    getNextSteps(studentId),
    db.query(
      `SELECT n.subject, n.message, n.sent_at
       FROM notifications n JOIN students s ON s.user_id = n.recipient_user_id
       WHERE s.student_id = $1
       ORDER BY n.sent_at DESC LIMIT $2`,
      [studentId, MAX_INTERVENTIONS]
    ),
    db.query("SELECT u.email FROM students s JOIN users u ON u.user_id = s.user_id WHERE s.student_id = $1", [studentId]),
  ]);
  const p = o.latestPrediction;
  const w = o.weakestCourse && o.courses.find((c) => c.course_code === o.weakestCourse.course_code);

  return {
    student: {
      name: o.profile.full_name,
      roll_no: o.profile.roll_no,
      email: user.rows[0].email,
      department: o.profile.department,
      semester: o.profile.current_semester,
    },
    standing: {
      official_cgpa: o.officialCgpa.value,
      projected_cgpa: o.projectedCgpa ? o.projectedCgpa.value : null,
      projected_is_estimate: !!o.projectedCgpa && o.projectedCgpa.source === "projected",
      provisional_sgpa: o.provisionalSgpa ? o.provisionalSgpa.value : null,
      previous_sgpa: o.previousSgpa ? o.previousSgpa.value : null,
    },
    status: p
      ? { label: p.final_label, reasons: p.reasons, updated_at: p.created_at, since: p.status_since }
      : null,
    attendance: {
      pct: o.liveAttendance.value,
      present: o.liveAttendance.present ?? null,
      sessions: o.liveAttendance.sessions ?? null,
      source: o.liveAttendance.source,
    },
    courses: o.courses.map((c) => ({
      code: c.course_code,
      title: c.title,
      marks: { assignment: c.assignment_avg, quiz: c.quiz_avg, midterm: c.midterm_marks, final: c.final_marks },
      mean: c.mean,
      grade: c.grade,
      attendance_pct: c.attendance_pct,
      present: c.present,
      sessions: c.sessions,
    })),
    weakest_course: w
      ? { code: w.course_code, title: w.title, mean: w.mean, grade: w.grade, attendance_pct: w.attendance_pct }
      : null,
    next_steps: nextSteps.map((s) => ({ id: s.id, text: s.text })),
    tutorial: null, // Phase 4
    counselor: null, // Phase 4
    interventions: interventions.rows.map((n) => ({ subject: n.subject, message: n.message, sent_at: n.sent_at })),
    thresholds: o.thresholds,
  };
}

module.exports = { buildChatContext };
