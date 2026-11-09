const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");
const { formatDateTime } = require("../src/services/timeFormat");

// Counselling-session notifications (Phase 7, step 2): schedule / reschedule / cancel notify the student
// and the counsellor (sender = the admin), marking attendance notifies the student, a refused booking
// notifies nobody. Uses one ordinary student with no counsellor history; everything is removed afterwards.
const since = new Date();
const as = (t) => ({ Authorization: `Bearer ${t}` });
const DAY = 86400000;
let admin, adminUserId, ayesha, ayeshaRow, S, sessionId;

function slot(d, hh = 11, mm = 0) {
  const day = new Date(Date.now() + d * DAY + 5 * 3600000).toISOString().slice(0, 10);
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`;
}

/** Notifications since the test started for this user, oldest first. */
async function inbox(userId) {
  const { rows } = await pool.query(
    `SELECT sender_admin_id, subject, message, link, kind FROM notifications
     WHERE recipient_user_id = $1 AND sent_at >= $2 AND link IN ('/student/counselling', '/faculty/counselling')
     ORDER BY notification_id`,
    [userId, since]
  );
  return rows;
}

beforeAll(async () => {
  const { rows } = await pool.query(
    `SELECT s.student_id, s.roll_no, s.full_name, s.user_id FROM students s JOIN users u ON u.user_id = s.user_id
     WHERE u.is_active AND s.roll_no LIKE 'BU-1004%'
       AND NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id)
       AND NOT EXISTS (SELECT 1 FROM counselling_sessions cs WHERE cs.student_id = s.student_id)
     ORDER BY s.student_id LIMIT 1`
  );
  S = rows[0];
  ayeshaRow = (
    await pool.query("SELECT f.faculty_id, f.user_id, f.full_name FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE u.email = 'ayesha.khan@smartedu.edu'")
  ).rows[0];
  adminUserId = (await pool.query("SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'")).rows[0].user_id;
  [admin, ayesha] = await Promise.all([login(app, "admin@smartedu.edu", "admin"), login(app, "ayesha.khan@smartedu.edu", "faculty")]);
});

afterAll(async () => {
  const s = await pool.query("SELECT session_id FROM counselling_sessions WHERE student_id = $1", [S.student_id]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselling_sessions' AND entity_id = ANY($1)", [s.rows.map((r) => r.session_id)]);
  await pool.query("DELETE FROM counselling_sessions WHERE student_id = $1", [S.student_id]);
  const a = await pool.query("SELECT id FROM counselor_assignments WHERE student_id = $1", [S.student_id]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselor_assignments' AND entity_id = ANY($1)", [a.rows.map((r) => r.id)]);
  await pool.query("DELETE FROM counselor_assignments WHERE student_id = $1", [S.student_id]);
  await pool.query(
    `DELETE FROM notifications WHERE sent_at >= $1 AND recipient_user_id = ANY($2)
       AND (subject IN ('Your academic counselor', 'New counselee') OR link IN ('/student/counselling', '/faculty/counselling'))`,
    [since, [S.user_id, ayeshaRow.user_id]]
  );
  await pool.end();
});

test("scheduling notifies the student and the counsellor with date, time, duration, place and the other person", async () => {
  const res = await request(app)
    .post("/api/admin/counselling-sessions")
    .set(as(admin))
    .send({ studentId: S.student_id, facultyId: ayeshaRow.faculty_id, scheduledAt: slot(5), mode: "in_person", location: "Room 204", agenda: "Midterm plan" });
  expect(res.status).toBe(201);
  sessionId = res.body.session.session_id;
  const when = formatDateTime(res.body.session.scheduled_at);
  expect(when).toMatch(/11:00 AM$/);

  const st = await inbox(S.user_id);
  expect(st).toEqual([
    {
      sender_admin_id: adminUserId,
      subject: "Counselling session booked",
      message: `Counselling session with Dr. Ayesha Khan on ${when} (30 min), Room 204. Agenda: Midterm plan`,
      link: "/student/counselling",
      kind: "counselor",
    },
  ]);
  const fa = await inbox(ayeshaRow.user_id);
  expect(fa).toEqual([
    {
      sender_admin_id: adminUserId,
      subject: "Counselling session booked",
      message: `Counselling session with ${S.full_name} (${S.roll_no}) on ${when} (30 min), Room 204. Agenda: Midterm plan`,
      link: "/faculty/counselling",
      kind: "counselor",
    },
  ]);
  // both see it through the bell's API
  const bell = await request(app).get("/api/notifications/mine").set(as(ayesha));
  expect(bell.body.notifications.some((n) => n.subject === "Counselling session booked" && n.message.includes(S.roll_no))).toBe(true);
});

test("a refused booking notifies nobody", async () => {
  const before = [(await inbox(S.user_id)).length, (await inbox(ayeshaRow.user_id)).length];
  const clash = await request(app)
    .post("/api/admin/counselling-sessions")
    .set(as(admin))
    .send({ studentId: S.student_id, scheduledAt: slot(5, 11, 15), mode: "online", location: "https://meet.example.com/x" });
  expect(clash.status).toBe(409);
  expect([(await inbox(S.user_id)).length, (await inbox(ayeshaRow.user_id)).length]).toEqual(before);
});

test("rescheduling notifies both with the old and the new time", async () => {
  const old = (await pool.query("SELECT scheduled_at FROM counselling_sessions WHERE session_id = $1", [sessionId])).rows[0].scheduled_at;
  const res = await request(app)
    .put(`/api/admin/counselling-sessions/${sessionId}/reschedule`)
    .set(as(admin))
    .send({ scheduledAt: slot(6, 15, 30), durationMin: 45, mode: "online", location: "https://meet.example.com/abc" });
  expect(res.status).toBe(200);
  const when = formatDateTime(res.body.session.scheduled_at);
  const st = (await inbox(S.user_id)).at(-1);
  expect(st).toMatchObject({ sender_admin_id: adminUserId, subject: "Counselling session moved", link: "/student/counselling" });
  expect(st.message).toBe(
    `Your counselling session with Dr. Ayesha Khan has moved from ${formatDateTime(old)} to ${when} (45 min), online (https://meet.example.com/abc).`
  );
  const fa = (await inbox(ayeshaRow.user_id)).at(-1);
  expect(fa).toMatchObject({ subject: "Counselling session moved", link: "/faculty/counselling" });
  expect(fa.message).toContain(`${S.full_name} (${S.roll_no})`);
  expect(fa.message).toContain(`to ${when} (45 min)`);
});

test("attendance notifies the student only (and again only when the value changes)", async () => {
  await pool.query("UPDATE counselling_sessions SET scheduled_at = NOW() - INTERVAL '1 hour' WHERE session_id = $1", [sessionId]);
  const facultyBefore = (await inbox(ayeshaRow.user_id)).length;
  const mark = (attendance, notes) =>
    request(app).put(`/api/faculty/counselling-sessions/${sessionId}/attendance`).set(as(ayesha)).send({ attendance, notes });
  expect((await mark("present")).status).toBe(200);
  const st = (await inbox(S.user_id)).at(-1);
  const when = formatDateTime((await pool.query("SELECT scheduled_at FROM counselling_sessions WHERE session_id = $1", [sessionId])).rows[0].scheduled_at);
  expect(st).toMatchObject({
    sender_admin_id: ayeshaRow.user_id,
    subject: "Counselling attendance",
    message: `Your counselling session with Dr. Ayesha Khan on ${when} was marked Present.`,
    link: "/student/counselling",
  });
  const count = (await inbox(S.user_id)).length;
  expect((await mark("present", "notes only")).status).toBe(200);
  expect((await inbox(S.user_id)).length).toBe(count);
  const override = await request(app).put(`/api/admin/counselling-sessions/${sessionId}/attendance`).set(as(admin)).send({ attendance: "absent" });
  expect(override.status).toBe(200);
  const fixed = (await inbox(S.user_id)).at(-1);
  expect(fixed).toMatchObject({ sender_admin_id: adminUserId, message: `Your counselling session with Dr. Ayesha Khan on ${when} was corrected to Absent.` });
  expect((await inbox(ayeshaRow.user_id)).length).toBe(facultyBefore);
});

test("cancelling notifies both with the reason", async () => {
  const res = await request(app)
    .post("/api/admin/counselling-sessions")
    .set(as(admin))
    .send({ studentId: S.student_id, scheduledAt: slot(8, 10, 0), mode: "in_person", location: "Room 12" });
  expect(res.status).toBe(201);
  const when = formatDateTime(res.body.session.scheduled_at);
  const c = await request(app).put(`/api/admin/counselling-sessions/${res.body.session.session_id}/cancel`).set(as(admin)).send({ reason: "Counsellor on leave" });
  expect(c.status).toBe(200);
  const st = (await inbox(S.user_id)).at(-1);
  expect(st).toMatchObject({
    sender_admin_id: adminUserId,
    subject: "Counselling session cancelled",
    message: `Your counselling session with Dr. Ayesha Khan on ${when} has been cancelled. Reason: Counsellor on leave`,
  });
  const fa = (await inbox(ayeshaRow.user_id)).at(-1);
  expect(fa).toMatchObject({
    subject: "Counselling session cancelled",
    message: `Your counselling session with ${S.full_name} (${S.roll_no}) on ${when} has been cancelled. Reason: Counsellor on leave`,
    link: "/faculty/counselling",
  });
});
