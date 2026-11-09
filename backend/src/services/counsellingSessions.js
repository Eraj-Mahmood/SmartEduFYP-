const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { assignCounselor, notify } = require("./counselors");
const { formatDateTime, formatRange } = require("./timeFormat");

// Counselling sessions (Phase 7). The admin books a session between a student and their counsellor
// (one active counsellor per student, see counselors.js); the counsellor - or the admin - marks
// Present / Absent once the session has started. A session whose end time has passed without
// attendance shows as "Awaiting attendance" and is a to-do for the counsellor: nothing is ever
// marked absent automatically. Sessions are cancelled, never deleted. Every write is audit-logged.

const MAX_DAYS_AHEAD = 60;
const httpError = (status, message, payload) => Object.assign(new Error(message), { status, payload });

const DISPLAY_LABELS = {
  upcoming: "Upcoming",
  awaiting_attendance: "Awaiting attendance",
  present: "Present",
  absent: "Absent",
  cancelled: "Cancelled",
};

// Computed on every read, never stored.
const DISPLAY_SQL = `CASE
    WHEN cs.status = 'cancelled' THEN 'cancelled'
    WHEN cs.attendance IS NOT NULL THEN cs.attendance
    WHEN cs.scheduled_at + cs.duration_min * INTERVAL '1 minute' <= NOW() THEN 'awaiting_attendance'
    ELSE 'upcoming' END`;

// Staff view (admin and the counsellor): everything, including the private notes.
const STAFF_SELECT = `
  SELECT cs.session_id, cs.assignment_id, cs.student_id, s.roll_no, s.full_name AS student_name,
         sd.code AS student_department, p.final_label,
         cs.faculty_id, f.full_name AS counsellor_name, f.designation AS counsellor_designation,
         cs.scheduled_at, cs.duration_min, cs.scheduled_at + cs.duration_min * INTERVAL '1 minute' AS ends_at,
         cs.mode, cs.location, cs.agenda, cs.reason, cs.status, cs.attendance, cs.counsellor_notes,
         cs.marked_by, cs.marked_at, cs.cancelled_reason, cs.created_by, cs.created_at, cs.updated_at,
         ${DISPLAY_SQL} AS display_status
  FROM counselling_sessions cs
  JOIN students s ON s.student_id = cs.student_id
  JOIN departments sd ON sd.department_id = s.department_id
  JOIN faculty f ON f.faculty_id = cs.faculty_id
  LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id`;

// Student view: an explicit column list - counsellor_notes and who marked it are never selected.
const STUDENT_SELECT = `
  SELECT cs.session_id, f.full_name AS counsellor_name, f.designation AS counsellor_designation,
         cs.scheduled_at, cs.duration_min, cs.scheduled_at + cs.duration_min * INTERVAL '1 minute' AS ends_at,
         cs.mode, cs.location, cs.agenda, cs.status, cs.attendance, cs.cancelled_reason,
         ${DISPLAY_SQL} AS display_status
  FROM counselling_sessions cs
  JOIN faculty f ON f.faculty_id = cs.faculty_id`;

// ---------------- notifications (Phase 7, step 2) ----------------
// Sent with the existing notify() helper inside the same transaction as the change, so a refused or
// failed write sends nothing. Schedule / reschedule / cancel go to both people (sender = the admin);
// attendance goes to the student (sender = whoever marked it).
const LINKS = { student: "/student/counselling", faculty: "/faculty/counselling" };
const place = (mode, location) => (mode === "online" ? `online (${location})` : location);
const details = (s) => `${formatDateTime(s.scheduled_at)} (${s.duration_min} min), ${place(s.mode, s.location)}`;

/** p: {studentUserId, studentName, rollNo, counsellorUserId, counsellorName} */
async function notifyBoth(db, sender, p, subject, forStudent, forCounsellor) {
  await notify(db, { sender, recipient: p.studentUserId, subject, message: forStudent, link: LINKS.student });
  await notify(db, { sender, recipient: p.counsellorUserId, subject, message: forCounsellor, link: LINKS.faculty });
}

const decorate = (row) => row && { ...row, display_label: DISPLAY_LABELS[row.display_status], when: formatDateTime(row.scheduled_at) };

async function getSession(id, db = pool) {
  const { rows } = await db.query(`${STAFF_SELECT} WHERE cs.session_id = $1`, [id]);
  return decorate(rows[0] || null);
}

/** scheduled_at must be in the future and at most 60 days ahead. */
function checkTime(scheduledAt) {
  const t = new Date(scheduledAt);
  if (Number.isNaN(t.getTime())) throw httpError(400, "scheduledAt must be a valid date and time");
  const now = Date.now();
  if (t.getTime() <= now) throw httpError(400, "The session time must be in the future");
  if (t.getTime() > now + MAX_DAYS_AHEAD * 86400000) throw httpError(400, `Sessions can be booked at most ${MAX_DAYS_AHEAD} days ahead`);
  return t;
}

// Serialises bookings per teacher and per student until the transaction ends, so two admins can't
// book the same slot at once. Always teacher first, then student, so two bookings can't deadlock.
async function lockPeople(client, facultyId, studentId) {
  await client.query("SELECT pg_advisory_xact_lock(7301, $1)", [facultyId]);
  await client.query("SELECT pg_advisory_xact_lock(7302, $1)", [studentId]);
}

/** 409 when the teacher or the student already has a (not cancelled) session overlapping this one. */
async function checkOverlap(client, { facultyId, studentId, start, durationMin, excludeId = 0 }) {
  const { rows } = await client.query(
    `SELECT cs.faculty_id, cs.student_id, cs.scheduled_at, cs.duration_min, f.full_name AS counsellor_name, s.full_name AS student_name
     FROM counselling_sessions cs
     JOIN faculty f ON f.faculty_id = cs.faculty_id
     JOIN students s ON s.student_id = cs.student_id
     WHERE cs.status = 'scheduled' AND cs.session_id <> $5
       AND (cs.faculty_id = $1 OR cs.student_id = $2)
       AND cs.scheduled_at < $3::timestamptz + $4 * INTERVAL '1 minute'
       AND cs.scheduled_at + cs.duration_min * INTERVAL '1 minute' > $3::timestamptz
     ORDER BY (cs.faculty_id = $1) DESC, cs.scheduled_at
     LIMIT 1`,
    [facultyId, studentId, start, durationMin, excludeId]
  );
  if (!rows.length) return;
  const c = rows[0];
  const who = c.faculty_id === facultyId ? c.counsellor_name : c.student_name;
  throw httpError(409, `${who} already has a counselling session on ${formatRange(c.scheduled_at, c.duration_min)}. Choose another time.`, {
    code: "SESSION_OVERLAP",
  });
}

async function loadStudent(client, studentId) {
  const { rows } = await client.query(
    `SELECT s.student_id, s.full_name, s.roll_no, s.user_id, u.is_active
     FROM students s JOIN users u ON u.user_id = s.user_id WHERE s.student_id = $1`,
    [studentId]
  );
  if (!rows.length) throw httpError(400, "Student not found");
  if (!rows[0].is_active) throw httpError(400, "That student's account is deactivated");
  return rows[0];
}

async function loadFaculty(client, facultyId) {
  const { rows } = await client.query(
    `SELECT f.faculty_id, f.full_name, f.user_id, u.is_active
     FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE f.faculty_id = $1`,
    [facultyId]
  );
  if (!rows.length) throw httpError(400, "Faculty member not found");
  if (!rows[0].is_active) throw httpError(400, "That faculty account is deactivated");
  return rows[0];
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * scheduleSession(input, actorUserId) -> {session, assignment: null | {id, created, closed}}
 * input: {studentId, facultyId?, scheduledAt, durationMin?, mode, location, agenda?, reason?, reassign?}
 * The counsellor defaults to the student's active one. A student without one gets this teacher as
 * counsellor (assignCounselor). A different teacher than the active counsellor -> 409
 * COUNSELLOR_CHANGE unless reassign is true, which makes them the counsellor (the old assignment is
 * closed). All in one transaction.
 */
async function scheduleSession(input, actorUserId) {
  const durationMin = input.durationMin || 30;
  const start = checkTime(input.scheduledAt);
  const result = await inTransaction(async (client) => {
    const student = await loadStudent(client, input.studentId);
    const cur = await client.query(
      `SELECT ca.id, ca.faculty_id, f.full_name FROM counselor_assignments ca JOIN faculty f ON f.faculty_id = ca.faculty_id
       WHERE ca.student_id = $1 AND ca.status = 'active'`,
      [student.student_id]
    );
    const current = cur.rows[0] || null;
    const facultyId = input.facultyId || (current && current.faculty_id);
    if (!facultyId) throw httpError(400, `${student.full_name} has no counsellor yet - choose one`);
    const faculty = await loadFaculty(client, facultyId);

    if (current && current.faculty_id !== faculty.faculty_id && !input.reassign) {
      throw httpError(409, `This makes ${faculty.full_name} the counsellor instead of ${current.full_name}.`, {
        code: "COUNSELLOR_CHANGE",
        currentCounsellor: { faculty_id: current.faculty_id, name: current.full_name },
        newCounsellor: { faculty_id: faculty.faculty_id, name: faculty.full_name },
      });
    }

    await lockPeople(client, faculty.faculty_id, student.student_id);
    await checkOverlap(client, { facultyId: faculty.faculty_id, studentId: student.student_id, start, durationMin });

    let assignmentId = current && current.id;
    let assignment = null;
    if (!current || current.faculty_id !== faculty.faculty_id) {
      const a = await assignCounselor({ studentId: student.student_id, facultyId: faculty.faculty_id, adminUserId: actorUserId }, { client });
      assignmentId = a.assignment.id;
      assignment = { id: assignmentId, created: true, closed: a.closed, previous_counsellor: current ? current.full_name : null };
    }

    const { rows } = await client.query(
      `INSERT INTO counselling_sessions
         (assignment_id, student_id, faculty_id, scheduled_at, duration_min, mode, location, agenda, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING session_id`,
      [
        assignmentId, student.student_id, faculty.faculty_id, start, durationMin, input.mode, input.location,
        input.agenda || null, input.reason || "manual", actorUserId,
      ]
    );
    const booked = { scheduled_at: start, duration_min: durationMin, mode: input.mode, location: input.location };
    const agenda = input.agenda ? ` Agenda: ${input.agenda}` : "";
    await notifyBoth(
      client,
      actorUserId,
      { studentUserId: student.user_id, counsellorUserId: faculty.user_id },
      "Counselling session booked",
      `Counselling session with ${faculty.full_name} on ${details(booked)}.${agenda}`,
      `Counselling session with ${student.full_name} (${student.roll_no}) on ${details(booked)}.${agenda}`
    );
    return { id: rows[0].session_id, assignment, student, faculty };
  });

  const session = await getSession(result.id);
  if (result.assignment) {
    await logAction(actorUserId, result.assignment.closed ? "REASSIGN_COUNSELOR" : "ASSIGN_COUNSELOR", "counselor_assignments", result.assignment.id, {
      student_id: session.student_id,
      roll_no: session.roll_no,
      faculty_id: session.faculty_id,
      faculty: session.counsellor_name,
      closed_assignment_id: result.assignment.closed,
      via: "counselling_session",
    });
  }
  await logAction(actorUserId, "SCHEDULE_SESSION", "counselling_sessions", session.session_id, {
    student_id: session.student_id,
    roll_no: session.roll_no,
    faculty_id: session.faculty_id,
    counsellor: session.counsellor_name,
    scheduled_at: session.scheduled_at,
    duration_min: session.duration_min,
    mode: session.mode,
    reason: session.reason,
    assignment_id: session.assignment_id,
    reassigned_from: result.assignment && result.assignment.previous_counsellor,
  });
  return { session, assignment: result.assignment };
}

/** Locks the session row; 404 when it doesn't exist. */
async function lockSession(client, id) {
  const { rows } = await client.query(
    `SELECT cs.*, f.user_id AS counsellor_user_id, f.full_name AS counsellor_name,
            s.user_id AS student_user_id, s.full_name AS student_name, s.roll_no
     FROM counselling_sessions cs
     JOIN faculty f ON f.faculty_id = cs.faculty_id
     JOIN students s ON s.student_id = cs.student_id
     WHERE cs.session_id = $1 FOR UPDATE OF cs`,
    [id]
  );
  if (!rows.length) throw httpError(404, "Session not found");
  return rows[0];
}

function assertChangeable(s, verb) {
  if (s.status === "cancelled") throw httpError(409, `This session was cancelled and can't be ${verb}`);
  if (s.attendance) throw httpError(409, `Attendance has already been marked for this session, so it can't be ${verb}`);
}

/**
 * rescheduleSession(id, {scheduledAt, durationMin?, mode?, location?, agenda?}, actorUserId)
 * Same rules as booking; only while attendance is not marked and the session isn't cancelled.
 */
async function rescheduleSession(id, input, actorUserId) {
  const start = checkTime(input.scheduledAt);
  const before = await inTransaction(async (client) => {
    const s = await lockSession(client, id);
    assertChangeable(s, "rescheduled");
    await loadStudent(client, s.student_id);
    await loadFaculty(client, s.faculty_id);
    const durationMin = input.durationMin || s.duration_min;
    await lockPeople(client, s.faculty_id, s.student_id);
    await checkOverlap(client, { facultyId: s.faculty_id, studentId: s.student_id, start, durationMin, excludeId: s.session_id });
    await client.query(
      `UPDATE counselling_sessions SET scheduled_at = $2, duration_min = $3, mode = $4, location = $5, agenda = $6, updated_at = NOW()
       WHERE session_id = $1`,
      [
        s.session_id, start, durationMin, input.mode || s.mode, input.location || s.location,
        input.agenda === undefined ? s.agenda : input.agenda || null,
      ]
    );
    const moved = { scheduled_at: start, duration_min: durationMin, mode: input.mode || s.mode, location: input.location || s.location };
    const from = formatDateTime(s.scheduled_at);
    await notifyBoth(
      client,
      actorUserId,
      { studentUserId: s.student_user_id, counsellorUserId: s.counsellor_user_id },
      "Counselling session moved",
      `Your counselling session with ${s.counsellor_name} has moved from ${from} to ${details(moved)}.`,
      `Your counselling session with ${s.student_name} (${s.roll_no}) has moved from ${from} to ${details(moved)}.`
    );
    return s;
  });
  const session = await getSession(id);
  await logAction(actorUserId, "RESCHEDULE_SESSION", "counselling_sessions", session.session_id, {
    roll_no: session.roll_no,
    counsellor: session.counsellor_name,
    from: { scheduled_at: before.scheduled_at, duration_min: before.duration_min, mode: before.mode, location: before.location },
    to: { scheduled_at: session.scheduled_at, duration_min: session.duration_min, mode: session.mode, location: session.location },
  });
  return { session, previous: { scheduled_at: before.scheduled_at, duration_min: before.duration_min } };
}

/** cancelSession(id, reason, actorUserId) - only while attendance is not marked. */
async function cancelSession(id, reason, actorUserId) {
  await inTransaction(async (client) => {
    const s = await lockSession(client, id);
    if (s.status === "cancelled") throw httpError(409, "This session is already cancelled");
    assertChangeable(s, "cancelled");
    await client.query(
      "UPDATE counselling_sessions SET status = 'cancelled', cancelled_reason = $2, updated_at = NOW() WHERE session_id = $1",
      [s.session_id, reason]
    );
    const when = formatDateTime(s.scheduled_at);
    await notifyBoth(
      client,
      actorUserId,
      { studentUserId: s.student_user_id, counsellorUserId: s.counsellor_user_id },
      "Counselling session cancelled",
      `Your counselling session with ${s.counsellor_name} on ${when} has been cancelled. Reason: ${reason}`,
      `Your counselling session with ${s.student_name} (${s.roll_no}) on ${when} has been cancelled. Reason: ${reason}`
    );
  });
  const session = await getSession(id);
  await logAction(actorUserId, "CANCEL_SESSION", "counselling_sessions", session.session_id, {
    roll_no: session.roll_no,
    counsellor: session.counsellor_name,
    scheduled_at: session.scheduled_at,
    reason,
  });
  return session;
}

/**
 * markAttendance(id, {attendance, notes?}, {userId, role})
 * The session's own counsellor or an admin (override), only once the session has started, never on a
 * cancelled one. Can be corrected later; every change is audit-logged with the old and new value.
 * `notes` (counsellor_notes, staff only) is left as it is when not sent.
 */
async function markAttendance(id, { attendance, notes }, actor) {
  const before = await inTransaction(async (client) => {
    const s = await lockSession(client, id);
    if (actor.role !== "admin" && s.counsellor_user_id !== actor.userId) {
      throw httpError(403, "Only this session's counsellor can mark its attendance");
    }
    if (s.status === "cancelled") throw httpError(409, "This session was cancelled, so attendance can't be marked");
    if (new Date(s.scheduled_at).getTime() > Date.now()) {
      throw httpError(409, `This session hasn't started yet (${formatDateTime(s.scheduled_at)}). Mark attendance once it has started.`);
    }
    await client.query(
      `UPDATE counselling_sessions
       SET attendance = $2, marked_by = $3, marked_at = NOW(), updated_at = NOW(),
           counsellor_notes = CASE WHEN $4::boolean THEN $5 ELSE counsellor_notes END
       WHERE session_id = $1`,
      [s.session_id, attendance, actor.userId, notes !== undefined, notes === undefined ? null : notes || null]
    );
    if (s.attendance !== attendance) {
      // a notes-only re-save doesn't notify the student again
      const word = attendance === "present" ? "Present" : "Absent";
      await notify(client, {
        sender: actor.userId,
        recipient: s.student_user_id,
        subject: "Counselling attendance",
        message: `Your counselling session with ${s.counsellor_name} on ${formatDateTime(s.scheduled_at)} ${s.attendance ? "was corrected to" : "was marked"} ${word}.`,
        link: LINKS.student,
      });
    }
    return s;
  });
  const session = await getSession(id);
  await logAction(actor.userId, "MARK_ATTENDANCE", "counselling_sessions", session.session_id, {
    roll_no: session.roll_no,
    counsellor: session.counsellor_name,
    scheduled_at: session.scheduled_at,
    attendance,
    previous: before.attendance,
    notes_changed: notes !== undefined && (notes || null) !== before.counsellor_notes,
    by: actor.role === "admin" ? "admin" : "counsellor",
  });
  return { session, previous: before.attendance };
}

// ---------------- reads ----------------

/**
 * Admin list: {counsellor, student, search, status, from, to, page, limit} -> {rows, total, page, limit, totalPages}
 * Newest first (by session time). `from` / `to` are Pakistan-time dates (YYYY-MM-DD), both inclusive.
 */
async function listForAdmin(f = {}) {
  const page = Math.max(1, f.page || 1);
  const limit = Math.min(100, Math.max(1, f.limit || 25));
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.counsellor) add("cs.faculty_id = ?", f.counsellor);
  if (f.student) add("cs.student_id = ?", f.student);
  if (f.search) add("(s.roll_no ILIKE ? OR s.full_name ILIKE ?)", `%${f.search}%`);
  if (f.status) add(`${DISPLAY_SQL} = ?`, f.status);
  if (f.from) add("cs.scheduled_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Karachi'", f.from);
  if (f.to) add("cs.scheduled_at < (?::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi'", f.to);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [count, rows] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM counselling_sessions cs JOIN students s ON s.student_id = cs.student_id ${whereSql}`,
      params
    ),
    pool.query(`${STAFF_SELECT} ${whereSql} ORDER BY cs.scheduled_at DESC, cs.session_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [
      ...params,
      limit,
      (page - 1) * limit,
    ]),
  ]);
  const total = count.rows[0].total;
  return { rows: rows.rows.map(decorate), total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * The counsellor's own sessions. view 'upcoming': not cancelled and not marked yet (incl. "Awaiting
 * attendance", the to-do list), soonest first. view 'history': marked or cancelled, newest first.
 */
async function listForFaculty(userId, view = "upcoming") {
  const upcoming = view !== "history";
  const { rows } = await pool.query(
    `${STAFF_SELECT}
     WHERE f.user_id = $1 AND ${upcoming ? "cs.status = 'scheduled' AND cs.attendance IS NULL" : "(cs.status = 'cancelled' OR cs.attendance IS NOT NULL)"}
     ORDER BY cs.scheduled_at ${upcoming ? "ASC" : "DESC"}, cs.session_id
     LIMIT 500`,
    [userId]
  );
  return rows.map(decorate);
}

/** The student's own sessions (no counsellor notes), newest first, plus attendance counts. */
async function listForStudent(userId) {
  const { rows } = await pool.query(
    `${STUDENT_SELECT}
     JOIN students s ON s.student_id = cs.student_id
     WHERE s.user_id = $1
     ORDER BY cs.scheduled_at DESC, cs.session_id DESC
     LIMIT 500`,
    [userId]
  );
  const sessions = rows.map(decorate);
  const count = (st) => sessions.filter((s) => s.display_status === st).length;
  const upcoming = sessions.filter((s) => s.display_status === "upcoming").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  return {
    sessions,
    summary: { attended: count("present"), missed: count("absent"), marked: count("present") + count("absent"), upcoming: upcoming.length },
    next: upcoming[0] || null,
  };
}

module.exports = {
  MAX_DAYS_AHEAD,
  DISPLAY_LABELS,
  scheduleSession,
  rescheduleSession,
  cancelSession,
  markAttendance,
  getSession,
  listForAdmin,
  listForFaculty,
  listForStudent,
};
