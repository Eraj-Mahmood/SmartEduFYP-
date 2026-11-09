const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

// Phase 7.1 Bugs 3 and 4: when a counsellor assignment ends, that counsellor's FUTURE unmarked sessions
// with the student are cancelled (both people notified, audit-logged). A past session still awaiting
// attendance keeps its counsellor, who can still mark it. Covers the four ways an assignment ends:
// reassign while scheduling, assign another counselor (Interventions), admin close, faculty close.
// Uses ordinary students with no counsellor history (not the demo accounts); everything is removed after.
const AYESHA = "ayesha.khan@smartedu.edu";
const ZAIN = "zain.abbas@smartedu.edu";
const BILAL = "bilal.raza@smartedu.edu";
const since = new Date();
const as = (t) => ({ Authorization: `Bearer ${t}` });
const DAY = 86400000;

let admin, ayesha, zain, students, ayeshaF, zainF, bilalF;

function slot(d, hh = 11, mm = 0) {
  const day = new Date(Date.now() + d * DAY + 5 * 3600000).toISOString().slice(0, 10);
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`;
}
async function facultyRow(email) {
  const { rows } = await pool.query(
    "SELECT f.faculty_id, f.user_id, f.full_name FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE u.email = $1",
    [email]
  );
  return rows[0];
}
const book = (body) => request(app).post("/api/admin/counselling-sessions").set(as(admin)).send(body);
const sessionsOf = async (studentId) =>
  (await pool.query("SELECT session_id, faculty_id, assignment_id, status, cancelled_reason, scheduled_at FROM counselling_sessions WHERE student_id = $1 ORDER BY session_id", [studentId])).rows;
const futureScheduled = async (studentId, facultyId) =>
  (
    await pool.query(
      "SELECT session_id FROM counselling_sessions WHERE student_id = $1 AND faculty_id = $2 AND status = 'scheduled' AND scheduled_at > NOW()",
      [studentId, facultyId]
    )
  ).rows;
const notesFor = async (userId, subject) =>
  (await pool.query("SELECT subject, message FROM notifications WHERE recipient_user_id = $1 AND sent_at >= $2 AND subject = $3", [userId, since, subject])).rows;

/** Student with Dr. Ayesha as counsellor, one future session (day d) and one past session awaiting attendance. */
async function setUp(student, d) {
  const r1 = await book({ studentId: student.student_id, facultyId: ayeshaF.faculty_id, scheduledAt: slot(d, 16, 10), mode: "in_person", location: "Room 1" });
  expect([r1.status, r1.body.error]).toEqual([201, undefined]);
  const r2 = await book({ studentId: student.student_id, scheduledAt: slot(d, 17, 10), mode: "online", location: "Teams" });
  expect(r2.status).toBe(201);
  // the second one moves into the past: awaiting attendance
  await pool.query("UPDATE counselling_sessions SET scheduled_at = NOW() - INTERVAL '2 hours' WHERE session_id = $1", [r2.body.session.session_id]);
  return { future: r1.body.session, past: r2.body.session, assignmentId: r1.body.session.assignment_id };
}

beforeAll(async () => {
  const { rows } = await pool.query(
    `SELECT s.student_id, s.roll_no, s.user_id, s.full_name, u.email FROM students s JOIN users u ON u.user_id = s.user_id
     WHERE u.is_active AND s.roll_no LIKE 'BU-1004%'
       AND NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id)
       AND NOT EXISTS (SELECT 1 FROM counselling_sessions cs WHERE cs.student_id = s.student_id)
     ORDER BY s.student_id LIMIT 4`
  );
  students = rows;
  [ayeshaF, zainF, bilalF] = await Promise.all([facultyRow(AYESHA), facultyRow(ZAIN), facultyRow(BILAL)]);
  [admin, ayesha, zain] = await Promise.all([login(app, "admin@smartedu.edu", "admin"), login(app, AYESHA, "faculty"), login(app, ZAIN, "faculty")]);
});

afterAll(async () => {
  const ids = students.map((s) => s.student_id);
  const s = await pool.query("SELECT session_id FROM counselling_sessions WHERE student_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselling_sessions' AND entity_id = ANY($1)", [s.rows.map((r) => r.session_id)]);
  await pool.query("DELETE FROM counselling_sessions WHERE student_id = ANY($1)", [ids]);
  const a = await pool.query("SELECT id FROM counselor_assignments WHERE student_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselor_assignments' AND entity_id = ANY($1)", [a.rows.map((r) => r.id)]);
  await pool.query("DELETE FROM counselor_assignments WHERE student_id = ANY($1)", [ids]);
  await pool.query(
    `DELETE FROM notifications WHERE sent_at >= $1
       AND recipient_user_id IN (SELECT user_id FROM students WHERE student_id = ANY($2)
                                 UNION SELECT user_id FROM faculty WHERE faculty_id = ANY($3))`,
    [since, ids, [ayeshaF.faculty_id, zainF.faculty_id, bilalF.faculty_id]]
  );
  await pool.end();
});

describe("Bug 3: changing the counsellor while scheduling (reassign=true)", () => {
  test("the 409 COUNSELLOR_CHANGE answer says how many sessions will be cancelled", async () => {
    const st = students[0];
    await setUp(st, 3);
    const res = await book({ studentId: st.student_id, facultyId: zainF.faculty_id, scheduledAt: slot(5, 16, 40), mode: "in_person", location: "Room 2" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COUNSELLOR_CHANGE");
    expect(res.body.upcomingWithCurrent).toBe(1);
    expect(res.body.cancelNote).toMatch(/1 upcoming session with Dr\. Ayesha Khan will be cancelled/);
  });

  test("after reassign: no future session left with the old counsellor; the past one stays and can be marked; both notified; audit-logged", async () => {
    const st = students[0];
    const before = await sessionsOf(st.student_id);
    const res = await book({ studentId: st.student_id, facultyId: zainF.faculty_id, scheduledAt: slot(5, 16, 40), mode: "in_person", location: "Room 2", reassign: true });
    expect(res.status).toBe(201);
    expect(await futureScheduled(st.student_id, ayeshaF.faculty_id)).toHaveLength(0);
    const after = await sessionsOf(st.student_id);
    const old = after.filter((s) => s.faculty_id === ayeshaF.faculty_id);
    const future = old.find((s) => new Date(s.scheduled_at) > new Date());
    const past = old.find((s) => new Date(s.scheduled_at) <= new Date());
    expect(future.status).toBe("cancelled");
    expect(future.cancelled_reason).toBe(`Counsellor changed to ${zainF.full_name}`);
    expect(past.status).toBe("scheduled"); // awaiting attendance, still Dr. Ayesha's
    expect(after.length).toBe(before.length + 1); // the new session with Mr. Zain
    // the old counsellor can still mark the past session
    const mark = await request(app).put(`/api/faculty/counselling-sessions/${past.session_id}/attendance`).set(as(ayesha)).send({ attendance: "present" });
    expect(mark.status).toBe(200);
    // both people notified about the cancellation
    expect((await notesFor(st.user_id, "Counselling session cancelled")).length).toBeGreaterThanOrEqual(1);
    const fac = await notesFor(ayeshaF.user_id, "Counselling session cancelled");
    expect(fac.some((n) => n.message.includes(st.roll_no) && n.message.includes(`Counsellor changed to ${zainF.full_name}`))).toBe(true);
    const audit = await pool.query("SELECT details FROM audit_log WHERE action = 'CANCEL_SESSION' AND entity_id = $1", [future.session_id]);
    expect(audit.rows[0].details).toMatchObject({ automatic: true, reason: `Counsellor changed to ${zainF.full_name}` });
  });

  test("assigning another counselor from Interventions cancels the old counsellor's future sessions too", async () => {
    const st = students[1];
    await setUp(st, 4);
    const res = await request(app).post("/api/admin/counselors").set(as(admin)).send({ studentId: st.student_id, facultyId: bilalF.faculty_id });
    expect(res.status).toBe(201);
    expect(res.body.cancelled_sessions).toBe(1);
    expect(await futureScheduled(st.student_id, ayeshaF.faculty_id)).toHaveLength(0);
  });
});

describe("Bug 4: closing a counselling assignment", () => {
  test("admin close: the count endpoint, then no future 'scheduled' session left for that assignment; both notified", async () => {
    const st = students[2];
    const { assignmentId, past } = await setUp(st, 6);
    const count = await request(app).get(`/api/admin/counselors/${assignmentId}/upcoming-sessions`).set(as(admin));
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(1);
    const res = await request(app).put(`/api/admin/counselors/${assignmentId}/close`).set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.cancelled_sessions).toBe(1);
    const left = await pool.query("SELECT 1 FROM counselling_sessions WHERE assignment_id = $1 AND status = 'scheduled' AND scheduled_at > NOW()", [assignmentId]);
    expect(left.rows).toHaveLength(0);
    const cancelled = await pool.query("SELECT cancelled_reason FROM counselling_sessions WHERE assignment_id = $1 AND status = 'cancelled'", [assignmentId]);
    expect(cancelled.rows.map((r) => r.cancelled_reason)).toEqual(["Counselling assignment closed"]);
    expect((await sessionsOf(st.student_id)).find((s) => s.session_id === past.session_id).status).toBe("scheduled");
    expect((await notesFor(st.user_id, "Counselling session cancelled")).length).toBe(1);
    expect((await notesFor(ayeshaF.user_id, "Counselling session cancelled")).some((n) => n.message.includes(st.roll_no))).toBe(true);
  });

  test("faculty closing their own counselee cancels the future sessions the same way", async () => {
    const st = students[3];
    const { assignmentId } = await setUp(st, 7);
    const res = await request(app).put(`/api/faculty/counselees/${assignmentId}`).set(as(ayesha)).send({ close: true });
    expect(res.status).toBe(200);
    expect(res.body.cancelled_sessions).toBe(1);
    expect(await futureScheduled(st.student_id, ayeshaF.faculty_id)).toHaveLength(0);
  });

  test("the count endpoint is admin-only and 404s an unknown assignment", async () => {
    expect((await request(app).get("/api/admin/counselors/99999999/upcoming-sessions").set(as(admin))).status).toBe(404);
    expect((await request(app).get("/api/admin/counselors/1/upcoming-sessions").set(as(zain))).status).toBe(403);
  });
});
