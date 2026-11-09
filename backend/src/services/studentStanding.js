const pool = require("../config/db");
const standing = require("./academicStanding");
const letters = require("./warningLetters");

// One student's academic standing (BU rules) for the student dashboard card and the admin drawer.
// Never mixed with the ML risk label. The student version is looked up by the JWT's user id only.

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * getStudentStanding({userId} | {studentId, staff}) ->
 * {status, label, count, programme, minimum, cgpa_used, semester_no, term, source, letters, hold, history, approvals?}
 */
async function getStudentStanding({ userId, studentId, staff = false }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.user_id, s.academic_status, s.probation_count, d.code AS department_code
     FROM students s JOIN departments d ON d.department_id = s.department_id
     WHERE ${userId ? "s.user_id = $1" : "s.student_id = $1"}`,
    [userId || studentId]
  );
  if (!rows.length) throw httpError(404, "Student not found");
  const s = rows[0];
  const programme = standing.programmeFor(s.department_code);
  const [hist, letterRows, hold, approvals] = await Promise.all([
    db.query(
      `SELECT a.id, a.status, a.probation_count, a.cgpa_used, a.semester_no, a.source, a.created_at, sc.term_label
       FROM academic_standing a LEFT JOIN semester_closes sc ON sc.id = a.close_id
       WHERE a.student_id = $1 ORDER BY a.id DESC`,
      [s.student_id]
    ),
    letters.lettersForStudentUser(s.user_id),
    letters.holdState(s.student_id, db),
    staff
      ? db.query(
          `SELECT e.id, e.standing_id, e.approver_role, e.note, e.approved_at, u.email AS recorded_by
           FROM enrolment_approvals e LEFT JOIN users u ON u.user_id = e.approved_by
           WHERE e.student_id = $1 ORDER BY e.id DESC`,
          [s.student_id]
        )
      : null,
  ]);
  const latest = hist.rows[0] || null;
  const onHold = s.academic_status === "probation_2" && standing.config.hold_on_probation_2;
  return {
    status: s.academic_status,
    label: standing.LABELS[s.academic_status],
    count: s.probation_count,
    probations_before_drop: standing.config.probations_before_drop,
    programme,
    minimum: standing.minimumFor(programme),
    cgpa_used: latest && latest.cgpa_used != null ? Number(latest.cgpa_used) : null,
    semester_no: latest ? latest.semester_no : null,
    term: latest ? latest.term_label : null,
    source: latest ? latest.source : null,
    letters: letterRows,
    hold: { active: onHold && !hold.approval_id, approved: Boolean(onHold && hold.approval_id), approver_role: hold.approver_role || null },
    history: hist.rows.map((h) => ({ ...h, label: standing.LABELS[h.status], cgpa_used: h.cgpa_used == null ? null : Number(h.cgpa_used) })),
    ...(staff ? { approvals: approvals.rows } : {}),
  };
}

module.exports = { getStudentStanding };
