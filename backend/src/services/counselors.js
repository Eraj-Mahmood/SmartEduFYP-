const pool = require("../config/db");
const { staffReasons } = require("./reasons");
const { getNextSteps } = require("./nextSteps");
const { recommendFor } = require("./tutorials");
const { getCourseSummary, round2 } = require("./studentCourses");
const { logAction } = require("../middleware/audit");
const { formatDateTime } = require("./timeFormat");

// Counselor assignments (FR12): one active faculty counselor per student, chosen by an admin.
// The faculty member gets a staff-worded summary of each counselee (and nothing more), the
// student sees who their counselor is, and both get an in-app notification.

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** The student's active counselor for the dashboard and chat, or null. */
async function getActiveCounselor(studentId, db = pool) {
  const { rows } = await db.query(
    `SELECT ca.id AS assignment_id, ca.created_at AS assigned_at, f.faculty_id, f.full_name AS name,
            f.designation, d.name AS department, u.email
     FROM counselor_assignments ca
     JOIN faculty f ON f.faculty_id = ca.faculty_id
     JOIN users u ON u.user_id = f.user_id
     JOIN departments d ON d.department_id = f.department_id
     WHERE ca.student_id = $1 AND ca.status = 'active'`,
    [studentId]
  );
  return rows[0] || null;
}

/** One assignment with the names an admin list needs. */
async function getAssignment(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ca.*, s.roll_no, s.full_name AS student_name, sd.code AS student_department,
            f.full_name AS faculty_name, f.designation AS faculty_designation, fd.code AS faculty_department,
            p.final_label
     FROM counselor_assignments ca
     JOIN students s ON s.student_id = ca.student_id
     JOIN departments sd ON sd.department_id = s.department_id
     JOIN faculty f ON f.faculty_id = ca.faculty_id
     JOIN departments fd ON fd.department_id = f.department_id
     LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     WHERE ca.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function notify(db, { sender, recipient, subject, message, predictionId = null, link = null }) {
  await db.query(
    `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message, related_prediction_id, link, kind)
     VALUES ($1, $2, $3, $4, $5, $6, 'counselor')`,
    [sender, recipient, subject, message, predictionId, link]
  );
}

// ---------------- orphaned sessions (Phase 7.1, Bugs 3 and 4) ----------------
// When an assignment ends (reassign, another counselor assigned, admin or faculty close), that
// counsellor's FUTURE unmarked sessions with the student are cancelled in the same transaction. A past
// session still awaiting attendance keeps its counsellor, who can still mark it.

/** The student's future, unmarked, scheduled sessions with this counsellor. */
async function upcomingSessions(db, studentId, facultyId) {
  const { rows } = await db.query(
    `SELECT session_id, scheduled_at FROM counselling_sessions
     WHERE student_id = $1 AND faculty_id = $2 AND status = 'scheduled' AND attendance IS NULL AND scheduled_at > NOW()
     ORDER BY scheduled_at`,
    [studentId, facultyId]
  );
  return rows;
}

/** "Her 1 upcoming session with Dr. Y will be cancelled." (null when there are none) */
function cancelNote(count, gender, counsellorName) {
  if (!count) return null;
  const owner = gender === "Female" ? "Her" : gender === "Male" ? "His" : "Their";
  return `${owner} ${count} upcoming session${count === 1 ? "" : "s"} with ${counsellorName} will be cancelled.`;
}

/**
 * cancelUpcomingSessions(db, {studentId, facultyId, reason, sender}) -> [{session_id, scheduled_at, roll_no, counsellor}]
 * Inside the caller's transaction: cancels them and notifies the student and the counsellor once each.
 * Audit rows are written after the commit with auditCancelled().
 */
async function cancelUpcomingSessions(db, { studentId, facultyId, reason, sender }) {
  const { rows } = await db.query(
    `UPDATE counselling_sessions SET status = 'cancelled', cancelled_reason = $3, updated_at = NOW()
     WHERE student_id = $1 AND faculty_id = $2 AND status = 'scheduled' AND attendance IS NULL AND scheduled_at > NOW()
     RETURNING session_id, scheduled_at`,
    [studentId, facultyId, reason]
  );
  if (!rows.length) return rows;
  rows.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const {
    rows: [who],
  } = await db.query(
    `SELECT s.user_id AS student_user_id, s.full_name AS student_name, s.roll_no, f.user_id AS counsellor_user_id, f.full_name AS counsellor_name
     FROM students s, faculty f WHERE s.student_id = $1 AND f.faculty_id = $2`,
    [studentId, facultyId]
  );
  const when = rows.map((r) => formatDateTime(r.scheduled_at)).join("; ");
  const what = rows.length === 1 ? "session" : `${rows.length} sessions`;
  const verb = rows.length === 1 ? "has" : "have";
  await notify(db, {
    sender,
    recipient: who.student_user_id,
    subject: "Counselling session cancelled",
    message: `Your counselling ${what} with ${who.counsellor_name} on ${when} ${verb} been cancelled. Reason: ${reason}`,
    link: "/student/counselling",
  });
  await notify(db, {
    sender,
    recipient: who.counsellor_user_id,
    subject: "Counselling session cancelled",
    message: `Your counselling ${what} with ${who.student_name} (${who.roll_no}) on ${when} ${verb} been cancelled. Reason: ${reason}`,
    link: "/faculty/counselling",
  });
  return rows.map((r) => ({ ...r, roll_no: who.roll_no, counsellor: who.counsellor_name }));
}

/** One CANCEL_SESSION audit row per automatically cancelled session (after the commit). */
async function auditCancelled(actorUserId, cancelled, reason, via) {
  for (const c of cancelled) {
    await logAction(actorUserId, "CANCEL_SESSION", "counselling_sessions", c.session_id, {
      roll_no: c.roll_no,
      counsellor: c.counsellor,
      scheduled_at: c.scheduled_at,
      reason,
      automatic: true,
      via,
    });
  }
}

/**
 * assignCounselor({studentId, facultyId, adminUserId}) -> {assignment, closed, cancelled, cancelReason}
 * Links the student's latest prediction. An existing active assignment is closed first
 * (409 if it is already this faculty member) and the old counsellor's future sessions are cancelled
 * (Phase 7.1; the caller writes their audit rows with auditCancelled). Notifies the student and the faculty member.
 * Runs in one transaction; the student row is locked so two admins can't race.
 */
async function assignCounselor({ studentId, facultyId, adminUserId }, { client: outer = null } = {}) {
  // With `client` the caller owns the transaction (counselling sessions book and assign in one go):
  // no BEGIN/COMMIT here, and an error is left for the caller to roll back.
  const client = outer || (await pool.connect());
  try {
    if (!outer) await client.query("BEGIN");
    const st = await client.query(
      `SELECT s.student_id, s.full_name, s.user_id, s.latest_prediction_id, p.final_label
       FROM students s LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       WHERE s.student_id = $1 FOR UPDATE OF s`,
      [studentId]
    );
    if (!st.rows.length) throw httpError(404, "Student not found");
    const fac = await client.query(
      `SELECT f.faculty_id, f.full_name, f.user_id, u.is_active
       FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE f.faculty_id = $1`,
      [facultyId]
    );
    if (!fac.rows.length) throw httpError(404, "Faculty member not found");
    if (!fac.rows[0].is_active) throw httpError(400, "That faculty account is deactivated");
    const student = st.rows[0];
    const faculty = fac.rows[0];

    const current = await client.query(
      "SELECT id, faculty_id FROM counselor_assignments WHERE student_id = $1 AND status = 'active'",
      [studentId]
    );
    let closed = null;
    let cancelled = [];
    const cancelReason = `Counsellor changed to ${faculty.full_name}`;
    if (current.rows.length) {
      if (current.rows[0].faculty_id === faculty.faculty_id) throw httpError(409, `${faculty.full_name} is already this student's counselor`);
      closed = current.rows[0].id;
      await client.query("UPDATE counselor_assignments SET status = 'closed', closed_at = NOW() WHERE id = $1", [closed]);
      cancelled = await cancelUpcomingSessions(client, {
        studentId,
        facultyId: current.rows[0].faculty_id,
        reason: cancelReason,
        sender: adminUserId,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO counselor_assignments (student_id, faculty_id, prediction_id, assigned_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [studentId, facultyId, student.latest_prediction_id, adminUserId]
    );
    const label = student.final_label ? ` (${student.final_label})` : "";
    await notify(client, {
      sender: adminUserId,
      recipient: student.user_id,
      subject: "Your academic counselor",
      message: `${faculty.full_name} is now your academic counselor. You can contact them any time about your studies.`,
      link: "/student#what-next",
    });
    await notify(client, {
      sender: adminUserId,
      recipient: faculty.user_id,
      subject: "New counselee",
      message: `You've been assigned as counselor to ${student.full_name}${label}.`,
      predictionId: student.latest_prediction_id,
      link: `/faculty/counselees?open=${rows[0].id}`,
    });
    if (!outer) await client.query("COMMIT");
    return { assignment: await getAssignment(rows[0].id, client), closed, cancelled, cancelReason };
  } catch (e) {
    if (!outer) await client.query("ROLLBACK");
    if (e.code === "23505") throw httpError(409, "This student already has an active counselor");
    throw e;
  } finally {
    if (!outer) client.release();
  }
}

const CLOSE_REASON = "Counselling assignment closed";

/**
 * closeAssignment(id, {actorUserId, via}) -> {...the closed row, cancelled_sessions}
 * (404 unknown, 409 already closed). In one transaction it also cancels the assignment's future
 * unmarked sessions (Phase 7.1 Bug 4) and notifies both people; audit rows after the commit.
 */
async function closeAssignment(id, { actorUserId = null, via = "admin" } = {}) {
  const client = await pool.connect();
  let cancelled;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "UPDATE counselor_assignments SET status = 'closed', closed_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id, student_id, faculty_id",
      [id]
    );
    if (!rows.length) {
      const exists = await client.query("SELECT 1 FROM counselor_assignments WHERE id = $1", [id]);
      throw exists.rows.length ? httpError(409, "This assignment is already closed") : httpError(404, "Assignment not found");
    }
    cancelled = await cancelUpcomingSessions(client, {
      studentId: rows[0].student_id,
      facultyId: rows[0].faculty_id,
      reason: CLOSE_REASON,
      sender: actorUserId,
    });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await auditCancelled(actorUserId, cancelled, CLOSE_REASON, `close_assignment_${via}`);
  return { ...(await getAssignment(id)), cancelled_sessions: cancelled.length };
}

/**
 * The counselee summary a counselor may see (staff wording): label, reasons, next steps,
 * recommended tutorial, attendance, notes and contact dates. Nothing else about the student.
 */
async function counseleeSummary(a) {
  const [pred, summary, upcoming] = await Promise.all([
    pool.query(
      `SELECT p.final_label, p.reasons, p.drivers, p.features, p.policy_reason, p.created_at
       FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.student_id = $1`,
      [a.student_id]
    ),
    getCourseSummary(a.student_id),
    a.faculty_id ? upcomingSessions(pool, a.student_id, a.faculty_id) : [],
  ]);
  const p = pred.rows[0] || null;
  const [nextSteps, recommendation] = await Promise.all([
    getNextSteps(a.student_id, { audience: "staff" }),
    recommendFor(a.student_id, { summary, label: p ? p.final_label : null }),
  ]);
  return {
    id: a.id,
    student_id: a.student_id,
    roll_no: a.roll_no,
    full_name: a.full_name,
    department: a.department,
    email: a.email,
    academic_status: a.academic_status,
    probation_count: a.probation_count,
    final_label: p ? p.final_label : null,
    reasons: p ? staffReasons(p) : [],
    last_predicted_at: p ? p.created_at : null,
    next_steps: nextSteps.map((s) => ({ id: s.id, text: s.text })),
    tutorial: recommendation && {
      course_code: recommendation.course.course_code,
      course_title: recommendation.course.title,
      reason: recommendation.reason,
      ...(recommendation.tutorial || {}),
      has_tutorial: !!recommendation.tutorial,
    },
    attendance:
      summary.sessions > 0
        ? { pct: round2((100 * summary.present) / summary.sessions), present: summary.present, sessions: summary.sessions }
        : null,
    notes: a.notes,
    upcoming_sessions: upcoming.length, // future sessions a close would cancel (Phase 7.1)
    last_contacted_at: a.last_contacted_at,
    assigned_at: a.created_at,
    status: a.status,
  };
}

/** Active (or one) assignment rows for a faculty member, with the student fields the summary needs. */
async function facultyAssignments(facultyId, { id } = {}) {
  const params = [facultyId];
  let extra = "";
  if (id) {
    params.push(id);
    extra = " AND ca.id = $2";
  }
  const { rows } = await pool.query(
    `SELECT ca.*, s.roll_no, s.full_name, d.name AS department, u.email, s.academic_status, s.probation_count
     FROM counselor_assignments ca
     JOIN students s ON s.student_id = ca.student_id
     JOIN departments d ON d.department_id = s.department_id
     JOIN users u ON u.user_id = s.user_id
     WHERE ca.faculty_id = $1 AND ca.status = 'active'${extra}
     -- Phase 7: students on probation first (Probation 2, then 1), then the least recently contacted
     ORDER BY CASE s.academic_status WHEN 'probation_2' THEN 0 WHEN 'probation_1' THEN 1 ELSE 2 END,
              ca.last_contacted_at ASC NULLS FIRST, ca.created_at`,
    params
  );
  return rows;
}

module.exports = {
  getActiveCounselor,
  getAssignment,
  assignCounselor,
  closeAssignment,
  upcomingSessions,
  cancelNote,
  cancelUpcomingSessions,
  auditCancelled,
  notify,
  counseleeSummary,
  facultyAssignments,
  httpError,
};
