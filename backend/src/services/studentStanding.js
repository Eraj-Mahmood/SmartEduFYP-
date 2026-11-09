const pool = require("../config/db");
const standing = require("./academicStanding");
const letters = require("./warningLetters");
const { buildFeatures, SGPA_SLOPE, SGPA_INTERCEPT } = require("./featureBuilder");
const { getCourseSummary } = require("./studentCourses");
const { markNeededFor, gradeFor } = require("./nextSteps");

const round2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * This term's target (reuses nextSteps.js): the whole-number average needed in every course for the
 * figure the term will be judged on (GPA in semester 1, else the projected CGPA) to reach the minimum.
 * null when there are no marks this term.
 */
async function thisTerm(studentId, semesterNo, minimum, db) {
  const [built, summary] = await Promise.all([buildFeatures(studentId, db), getCourseSummary(studentId, db)]);
  if (!built) return null;
  const marked = summary.courses.filter((c) => c.mean != null);
  if (!marked.length) return null;
  const f = built.features;
  const credits = marked.reduce((n, c) => n + c.credit_hours, 0);
  const mean = round2(marked.reduce((n, c) => n + c.credit_hours * c.mean, 0) / credits);
  const firstSemester = semesterNo === 1 && standing.config.first_semester_uses_gpa;
  let mark;
  if (firstSemester) {
    mark = 0;
    while (mark <= 100 && round2(clamp(SGPA_SLOPE * mark + SGPA_INTERCEPT, 0, 4)) < minimum) mark++;
  } else {
    if (f.Previous_SGPA == null) return null;
    mark = markNeededFor(minimum, f.Previous_SGPA);
  }
  const now = firstSemester ? f.SGPA : f.CGPA;
  const reachable = Number.isFinite(mark) && mark <= 100;
  return {
    uses: firstSemester ? "GPA" : "CGPA",
    current: now == null ? null : round2(now),
    current_mean: mean,
    needed_mark: reachable ? mark : null,
    needed_grade: reachable ? gradeFor(mark) : null,
    reachable,
    on_track: now != null && round2(now) >= minimum,
  };
}

// One student's academic standing (BU rules) for the student dashboard card and the admin drawer.
// Never mixed with the ML risk label. The student version is looked up by the JWT's user id only.

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * getStudentStanding({userId} | {studentId, staff}) ->
 * {status, label, count, programme, minimum, cgpa_used, semester_no, term, source, letters, hold, history, approvals?}
 */
async function getStudentStanding({ userId, studentId, staff = false }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.user_id, s.academic_status, s.probation_count, s.current_semester, d.code AS department_code
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
  const minimum = standing.minimumFor(programme);
  const term = s.academic_status === "dropped" ? null : await thisTerm(s.student_id, s.current_semester, minimum, db);
  const onHold = s.academic_status === "probation_2" && standing.config.hold_on_probation_2;
  return {
    status: s.academic_status,
    label: standing.LABELS[s.academic_status],
    count: s.probation_count,
    probations_before_drop: standing.config.probations_before_drop,
    programme,
    minimum,
    this_term: term,
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

/**
 * Admin probation list: {status (probation_1 | probation_2 | dropped | on_probation), search, page, limit}
 * -> {rows, total, page, limit, totalPages}. Each row: the student, standing, latest risk label,
 * counsellor, their latest letter and whether a Probation 2 approval is recorded.
 */
async function listStanding({ status = "on_probation", search, page = 1, limit = 25 } = {}) {
  const params = [];
  const where = [];
  if (status === "on_probation") where.push("s.academic_status IN ('probation_1', 'probation_2')");
  else if (standing.STATUSES.includes(status)) {
    params.push(status);
    where.push(`s.academic_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(s.roll_no ILIKE $${params.length} OR s.full_name ILIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [count, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM students s ${w}`, params),
    pool.query(
      `SELECT s.student_id, s.roll_no, s.full_name, d.code AS department_code, s.academic_status, s.probation_count,
              s.current_semester, p.final_label, a.id AS standing_id, a.cgpa_used, a.source, sc.term_label,
              ca.faculty_id AS counsellor_id, f.full_name AS counsellor_name,
              wl.id AS letter_id, wl.level AS letter_level, wl.acknowledged_at,
              ap.approver_role
       FROM students s
       JOIN departments d ON d.department_id = s.department_id
       LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       LEFT JOIN LATERAL (SELECT * FROM academic_standing x WHERE x.student_id = s.student_id ORDER BY x.id DESC LIMIT 1) a ON TRUE
       LEFT JOIN semester_closes sc ON sc.id = a.close_id
       LEFT JOIN counselor_assignments ca ON ca.student_id = s.student_id AND ca.status = 'active'
       LEFT JOIN faculty f ON f.faculty_id = ca.faculty_id
       LEFT JOIN warning_letters wl ON wl.standing_id = a.id
       LEFT JOIN LATERAL (SELECT approver_role FROM enrolment_approvals e WHERE e.standing_id = a.id ORDER BY e.id DESC LIMIT 1) ap ON TRUE
       ${w}
       ORDER BY CASE s.academic_status WHEN 'dropped' THEN 0 WHEN 'probation_2' THEN 1 WHEN 'probation_1' THEN 2 ELSE 3 END,
                (a.source = 'close') DESC, a.cgpa_used NULLS LAST, s.roll_no
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
  ]);
  const total = count.rows[0].n;
  return {
    rows: rows.rows.map((r) => ({
      ...r,
      label: standing.LABELS[r.academic_status],
      cgpa_used: r.cgpa_used == null ? null : Number(r.cgpa_used),
      hold: r.academic_status === "probation_2" && standing.config.hold_on_probation_2 ? (r.approver_role ? "approved" : "on_hold") : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { getStudentStanding, listStanding };
