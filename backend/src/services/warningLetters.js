const pool = require("../config/db");
const standing = require("./academicStanding");
const { formatDay, formatDateTime } = require("./timeFormat");

// Warning letters (Handbook 5.5.2: after each probation the HoD issues a formal warning letter, which
// the student acknowledges; a copy is kept on record) and the Probation 2 enrolment hold (5.5.5).

const httpError = (status, message, payload) => Object.assign(new Error(message), { status, payload });
const fmt = (v) => Number(v).toFixed(2);

const LETTER_SELECT = `
  SELECT w.id, w.level, w.issued_at, w.acknowledged_at, w.student_id, w.standing_id,
         a.cgpa_used, a.semester_no, a.status, sc.term_label,
         s.full_name, s.roll_no, d.code AS department_code, d.name AS department, iu.email AS issued_by_email
  FROM warning_letters w
  JOIN academic_standing a ON a.id = w.standing_id
  LEFT JOIN semester_closes sc ON sc.id = a.close_id
  JOIN students s ON s.student_id = w.student_id
  JOIN departments d ON d.department_id = s.department_id
  LEFT JOIN users iu ON iu.user_id = w.issued_by`;

/** The letter as printable content (the same text for the admin print view and the student). */
function letterContent(r) {
  const programme = standing.programmeFor(r.department_code);
  const min = fmt(standing.minimumFor(programme));
  const levelText = r.level === 1 ? "first probation" : "second consecutive probation";
  const measure = r.semester_no === 1 && standing.config.first_semester_uses_gpa ? "GPA" : "CGPA";
  const next = [`Raise your CGPA to at least ${min} by the end of the next semester. Doing so takes you off probation (Handbook 5.5.4).`];
  if (r.level === 2 && standing.config.hold_on_probation_2) {
    next.push("You may not register for a new course or semester without the Principal's prior approval, obtained through the Head of Department (Handbook 5.5.5).");
  }
  next.push(
    `If your CGPA stays below ${min} in the semester immediately after two consecutive probations, you will be dropped from the programme (Handbook 5.5.3).`,
    "Meet your academic counsellor early in the semester to plan how to improve."
  );
  return {
    id: r.id,
    date: formatDay(r.issued_at),
    issued_at: r.issued_at,
    student: { name: r.full_name, roll_no: r.roll_no, department: r.department, programme },
    term: r.term_label || `Semester ${r.semester_no}`,
    measure,
    cgpa: r.cgpa_used == null ? null : fmt(r.cgpa_used),
    minimum: min,
    level: r.level,
    level_text: levelText,
    title: `Academic warning - ${r.level === 1 ? "Probation 1 of 2" : "Probation 2 of 2"}`,
    body:
      `This letter is to inform you that at the end of ${r.term_label || `semester ${r.semester_no}`} your ${measure} was ${fmt(r.cgpa_used)}, ` +
      `below the minimum of ${min} required for your programme (${programme}). Under clause 5.5 of the BU Student Handbook you have been placed on ` +
      `${levelText}.`,
    next_steps: next,
    signature: "Head of Department",
    acknowledged_at: r.acknowledged_at,
    acknowledged_text: r.acknowledged_at ? `Acknowledged by the student on ${formatDateTime(r.acknowledged_at)}` : null,
  };
}

async function getLetter(id, db = pool) {
  const { rows } = await db.query(`${LETTER_SELECT} WHERE w.id = $1`, [id]);
  return rows[0] || null;
}

/** Admin list: {student?, acknowledged?, page, limit}. */
async function listLetters({ student, acknowledged, page = 1, limit = 25 } = {}) {
  const where = [];
  const params = [];
  if (student) {
    params.push(student);
    where.push(`w.student_id = $${params.length}`);
  }
  if (acknowledged === "yes") where.push("w.acknowledged_at IS NOT NULL");
  if (acknowledged === "no") where.push("w.acknowledged_at IS NULL");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [count, rows] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM warning_letters w ${w}`, params),
    pool.query(`${LETTER_SELECT} ${w} ORDER BY w.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit]),
  ]);
  const total = count.rows[0].n;
  return { rows: rows.rows.map(letterContent), total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** The student's own letters (newest first). */
async function lettersForStudentUser(userId) {
  const { rows } = await pool.query(`${LETTER_SELECT} WHERE s.user_id = $1 ORDER BY w.id DESC`, [userId]);
  return rows.map(letterContent);
}

/** acknowledge(letterId, studentUserId): own letters only (404 otherwise); once (409 after). */
async function acknowledge(id, userId) {
  const { rows } = await pool.query(
    `UPDATE warning_letters w SET acknowledged_at = NOW()
     FROM students s WHERE w.id = $1 AND s.student_id = w.student_id AND s.user_id = $2 AND w.acknowledged_at IS NULL
     RETURNING w.id`,
    [id, userId]
  );
  if (!rows.length) {
    const own = await pool.query(
      "SELECT w.acknowledged_at FROM warning_letters w JOIN students s ON s.student_id = w.student_id WHERE w.id = $1 AND s.user_id = $2",
      [id, userId]
    );
    if (!own.rows.length) throw httpError(404, "Letter not found");
    throw httpError(409, "You have already acknowledged this letter");
  }
  return letterContent(await getLetter(id));
}

// ---------------- Probation 2 enrolment hold (5.5.5) ----------------

/** The student's current standing with its approval: {status, count, standing_id, approval}. */
async function holdState(studentId, db = pool) {
  const { rows } = await db.query(
    `SELECT s.academic_status AS status, s.probation_count AS count, a.id AS standing_id,
            ap.id AS approval_id, ap.approver_role, ap.approved_at
     FROM students s
     LEFT JOIN LATERAL (SELECT id FROM academic_standing x WHERE x.student_id = s.student_id ORDER BY x.id DESC LIMIT 1) a ON TRUE
     LEFT JOIN LATERAL (SELECT * FROM enrolment_approvals e WHERE e.standing_id = a.id ORDER BY e.id DESC LIMIT 1) ap ON TRUE
     WHERE s.student_id = $1`,
    [studentId]
  );
  return rows[0] || null;
}

/** Throws 409 STUDENT_DROPPED / ENROLMENT_HOLD when the student may not be enrolled; otherwise returns. */
async function assertMayEnrol(studentId, db = pool) {
  const h = await holdState(studentId, db);
  if (!h) return;
  if (h.status === "dropped") {
    throw httpError(409, "This student has been dropped from the programme (BU Student Handbook 5.5.3) and can't be enrolled.", {
      code: "STUDENT_DROPPED",
      studentId,
    });
  }
  if (h.status === "probation_2" && standing.config.hold_on_probation_2 && !h.approval_id) {
    throw httpError(
      409,
      "This student is on Probation 2 of 2. They can't be enrolled without the Principal's prior approval through the HoD (Handbook 5.5.5). Record the approval first.",
      { code: "ENROLMENT_HOLD", studentId, standingId: h.standing_id }
    );
  }
}

/** recordApproval(studentId, {approverRole, note}, adminUserId) - only for a student on Probation 2, once per standing. */
async function recordApproval(studentId, { approverRole, note }, adminUserId) {
  const h = await holdState(studentId);
  if (!h) throw httpError(404, "Student not found");
  if (h.status !== "probation_2") throw httpError(409, "Only a student on Probation 2 of 2 needs an enrolment approval.");
  if (h.approval_id) throw httpError(409, `An approval is already recorded for this probation (${h.approver_role}).`);
  const { rows } = await pool.query(
    `INSERT INTO enrolment_approvals (standing_id, student_id, approved_by, approver_role, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [h.standing_id, studentId, adminUserId, approverRole, note || null]
  );
  return rows[0];
}

module.exports = { letterContent, getLetter, listLetters, lettersForStudentUser, acknowledge, holdState, assertMayEnrol, recordApproval };
