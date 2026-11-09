const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

// Counselling sessions (Phase 7, step 1). Uses two ordinary students with no counsellor history (not
// the demo accounts) and Dr. Ayesha Khan / Mr. Zain Abbas; everything the tests create is removed
// afterwards and any account they deactivate is reactivated.
const AYESHA = "ayesha.khan@smartedu.edu";
const ZAIN = "zain.abbas@smartedu.edu";
const since = new Date();
const as = (t) => ({ Authorization: `Bearer ${t}` });
const DAY = 86400000;

let admin, ayesha, zain, tokA, tokB, A, B, ayeshaId, zainId;

/** A future slot on day `d` (from now) at hh:mm Pakistan time, as ISO with +05:00. */
function slot(d, hh = 11, mm = 0) {
  const day = new Date(Date.now() + d * DAY + 5 * 3600000).toISOString().slice(0, 10);
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`;
}

async function facultyRow(email) {
  const { rows } = await pool.query("SELECT f.faculty_id, f.user_id FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE u.email = $1", [email]);
  return rows[0];
}

/** Moves a session into the past (the API refuses to book one there). */
async function moveToPast(id, minutesAgo = 60) {
  await pool.query("UPDATE counselling_sessions SET scheduled_at = NOW() - $2 * INTERVAL '1 minute' WHERE session_id = $1", [id, minutesAgo]);
}

const book = (body, token = admin) => request(app).post("/api/admin/counselling-sessions").set(as(token)).send(body);
const base = (student, extra = {}) => ({ studentId: student.student_id, scheduledAt: slot(10), mode: "in_person", location: "Room 204", ...extra });

beforeAll(async () => {
  // two active students that have never had a counsellor or a session
  const { rows } = await pool.query(
    `SELECT s.student_id, s.roll_no, s.user_id, u.email FROM students s JOIN users u ON u.user_id = s.user_id
     WHERE u.is_active AND s.roll_no LIKE 'BU-1003%'
       AND NOT EXISTS (SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = s.student_id)
       AND NOT EXISTS (SELECT 1 FROM counselling_sessions cs WHERE cs.student_id = s.student_id)
     ORDER BY s.student_id LIMIT 2`
  );
  [A, B] = rows;
  const [ay, za] = await Promise.all([facultyRow(AYESHA), facultyRow(ZAIN)]);
  ayeshaId = ay.faculty_id;
  zainId = za.faculty_id;
  [admin, ayesha, zain, tokA, tokB] = await Promise.all([
    login(app, "admin@smartedu.edu", "admin"),
    login(app, AYESHA, "faculty"),
    login(app, ZAIN, "faculty"),
    login(app, A.email, "student"),
    login(app, B.email, "student"),
  ]);
});

afterAll(async () => {
  const ids = [A.student_id, B.student_id];
  await pool.query("UPDATE users SET is_active = TRUE WHERE user_id = ANY($1)", [[A.user_id, B.user_id]]);
  const s = await pool.query("SELECT session_id FROM counselling_sessions WHERE student_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselling_sessions' AND entity_id = ANY($1)", [s.rows.map((r) => r.session_id)]);
  await pool.query("DELETE FROM counselling_sessions WHERE student_id = ANY($1)", [ids]);
  const a = await pool.query("SELECT id FROM counselor_assignments WHERE student_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselor_assignments' AND entity_id = ANY($1)", [a.rows.map((r) => r.id)]);
  await pool.query("DELETE FROM counselor_assignments WHERE student_id = ANY($1)", [ids]);
  await pool.query(
    `DELETE FROM notifications WHERE sent_at >= $1
       AND (subject IN ('Your academic counselor', 'New counselee') OR link IN ('/student/counselling', '/faculty/counselling'))
       AND recipient_user_id IN (SELECT user_id FROM students WHERE student_id = ANY($2)
                                 UNION SELECT user_id FROM faculty WHERE faculty_id = ANY($3))`,
    [since, ids, [ayeshaId, zainId]]
  );
  await pool.end();
});

describe("scheduling", () => {
  let first;

  test("a student without a counsellor gets the chosen teacher as counsellor and the session is booked", async () => {
    const res = await book(base(A, { facultyId: ayeshaId, agenda: "Plan for the midterm", reason: "risk" }));
    expect(res.status).toBe(201);
    first = res.body.session;
    expect(first).toMatchObject({
      student_id: A.student_id,
      faculty_id: ayeshaId,
      duration_min: 30,
      mode: "in_person",
      location: "Room 204",
      reason: "risk",
      status: "scheduled",
      attendance: null,
      display_status: "upcoming",
      display_label: "Upcoming",
    });
    expect(first.when).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} \d{4}, 11:00 AM$/);
    expect(res.body.assignment).toMatchObject({ created: true, closed: null });
    const { rows } = await pool.query("SELECT id, faculty_id FROM counselor_assignments WHERE student_id = $1 AND status = 'active'", [A.student_id]);
    expect(rows).toEqual([{ id: first.assignment_id, faculty_id: ayeshaId }]);
  });

  test("the counsellor defaults to the student's active one", async () => {
    const res = await book(base(A, { scheduledAt: slot(11) }));
    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({ faculty_id: ayeshaId, assignment_id: first.assignment_id });
    expect(res.body.assignment).toBeNull();
  });

  test("no counsellor and none chosen -> 400", async () => {
    const res = await book(base(B, { scheduledAt: slot(12) }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no counsellor yet/);
  });

  test("a past time, or more than 60 days ahead, is refused with 400", async () => {
    const past = await book(base(A, { facultyId: ayeshaId, scheduledAt: new Date(Date.now() - 3600000).toISOString() }));
    expect(past.status).toBe(400);
    expect(past.body.error).toMatch(/future/);
    const far = await book(base(A, { facultyId: ayeshaId, scheduledAt: slot(61) }));
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/60 days/);
  });

  test("a time without a time zone and bad fields are refused by validation", async () => {
    const res = await book(base(A, { scheduledAt: "2026-12-01T11:00", durationMin: 200, mode: "phone", location: "" }));
    expect(res.status).toBe(400);
    for (const field of ["scheduledAt must be a date and time with a time zone", "durationMin", "mode", "location"]) {
      expect(res.body.details.some((d) => d.startsWith(field))).toBe(true);
    }
  });

  test("an inactive student or teacher -> 400", async () => {
    await pool.query("UPDATE users SET is_active = FALSE WHERE user_id = $1", [B.user_id]);
    try {
      const res = await book(base(B, { facultyId: zainId, scheduledAt: slot(13) }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/deactivated/);
    } finally {
      await pool.query("UPDATE users SET is_active = TRUE WHERE user_id = $1", [B.user_id]);
    }
    const zainUser = (await facultyRow(ZAIN)).user_id;
    await pool.query("UPDATE users SET is_active = FALSE WHERE user_id = $1", [zainUser]);
    try {
      const res = await book(base(B, { facultyId: zainId, scheduledAt: slot(13) }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/faculty account is deactivated/);
    } finally {
      await pool.query("UPDATE users SET is_active = TRUE WHERE user_id = $1", [zainUser]);
    }
    const unknown = await book(base({ student_id: 99999999 }, { facultyId: zainId, scheduledAt: slot(13) }));
    expect(unknown.status).toBe(400);
  });

  test("overlapping sessions for the same teacher or the same student -> 409 with the clash", async () => {
    // A has 10 days out 11:00-11:30 with Ayesha. B with Ayesha at 11:15 clashes on the teacher.
    const teacher = await book(base(B, { facultyId: ayeshaId, scheduledAt: slot(10, 11, 15) }));
    expect(teacher.status).toBe(409);
    expect(teacher.body.code).toBe("SESSION_OVERLAP");
    expect(teacher.body.error).toMatch(/^Dr\. Ayesha Khan already has a counselling session on .* 11:00 AM to 11:30 AM/);
    // back-to-back is fine
    const after = await book(base(B, { facultyId: ayeshaId, scheduledAt: slot(10, 11, 30) }));
    expect(after.status).toBe(201);
    // B now has 11:30-12:00; a 60-minute session for B at 11:00 clashes on the student
    const student = await book(base(B, { scheduledAt: slot(10, 11, 0), durationMin: 60 }));
    expect(student.status).toBe(409);
    expect(student.body.error).toMatch(/already has a counselling session/);
  });

  test("a different teacher than the active counsellor -> 409 unless reassign=true", async () => {
    const refused = await book(base(B, { facultyId: zainId, scheduledAt: slot(14) }));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "COUNSELLOR_CHANGE",
      currentCounsellor: { faculty_id: ayeshaId, name: "Dr. Ayesha Khan" },
      newCounsellor: { faculty_id: zainId, name: "Mr. Zain Abbas" },
    });
    expect(refused.body.error).toBe("This makes Mr. Zain Abbas the counsellor instead of Dr. Ayesha Khan.");
    // nothing changed
    const before = await pool.query("SELECT faculty_id FROM counselor_assignments WHERE student_id = $1 AND status = 'active'", [B.student_id]);
    expect(before.rows).toEqual([{ faculty_id: ayeshaId }]);

    const ok = await book(base(B, { facultyId: zainId, scheduledAt: slot(14), reassign: true }));
    expect(ok.status).toBe(201);
    expect(ok.body.assignment.closed).toEqual(expect.any(Number));
    const { rows } = await pool.query("SELECT faculty_id, status FROM counselor_assignments WHERE student_id = $1 ORDER BY id", [B.student_id]);
    expect(rows).toEqual([
      { faculty_id: ayeshaId, status: "closed" },
      { faculty_id: zainId, status: "active" },
    ]);
  });

  test("a failed booking leaves no reassignment behind (one transaction)", async () => {
    // B's counsellor is Zain; booking Ayesha with reassign at a time that clashes with Ayesha's session fails
    const res = await book(base(B, { facultyId: ayeshaId, scheduledAt: slot(10, 11, 0), reassign: true }));
    expect(res.status).toBe(409);
    const { rows } = await pool.query("SELECT faculty_id FROM counselor_assignments WHERE student_id = $1 AND status = 'active'", [B.student_id]);
    expect(rows).toEqual([{ faculty_id: zainId }]);
  });
});

describe("attendance, reschedule and cancel", () => {
  let future, past, cancelled;

  beforeAll(async () => {
    future = (await book(base(A, { scheduledAt: slot(20) }))).body.session;
    past = (await book(base(A, { scheduledAt: slot(21) }))).body.session;
    cancelled = (await book(base(A, { scheduledAt: slot(22) }))).body.session;
    await moveToPast(past.session_id, 90);
  });

  const mark = (id, token, body) => request(app).put(`/api/faculty/counselling-sessions/${id}/attendance`).set(as(token)).send(body);

  test("a past session without attendance shows as Awaiting attendance and is on the counsellor's to-do list", async () => {
    const res = await request(app).get("/api/faculty/counselling-sessions?view=upcoming").set(as(ayesha));
    expect(res.status).toBe(200);
    const row = res.body.sessions.find((s) => s.session_id === past.session_id);
    expect(row).toMatchObject({ display_status: "awaiting_attendance", display_label: "Awaiting attendance", attendance: null });
  });

  test("marking before the start time is refused", async () => {
    const res = await mark(future.session_id, ayesha, { attendance: "present" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hasn't started yet/);
  });

  test("another teacher can't mark the session (403)", async () => {
    const res = await mark(past.session_id, zain, { attendance: "present" });
    expect(res.status).toBe(403);
  });

  test("the counsellor marks it, with private notes", async () => {
    const res = await mark(past.session_id, ayesha, { attendance: "present", notes: "Discussed a study plan" });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({ attendance: "present", display_status: "present", counsellor_notes: "Discussed a study plan" });
    expect(res.body.session.marked_at).toBeTruthy();
    const hist = await request(app).get("/api/faculty/counselling-sessions?view=history").set(as(ayesha));
    expect(hist.body.sessions.map((s) => s.session_id)).toContain(past.session_id);
  });

  test("attendance can be corrected later; the admin can override it; notes are kept when not sent", async () => {
    const fix = await mark(past.session_id, ayesha, { attendance: "absent" });
    expect(fix.status).toBe(200);
    expect(fix.body).toMatchObject({ previous: "present", session: { attendance: "absent", counsellor_notes: "Discussed a study plan" } });
    const override = await request(app)
      .put(`/api/admin/counselling-sessions/${past.session_id}/attendance`)
      .set(as(admin))
      .send({ attendance: "present" });
    expect(override.status).toBe(200);
    expect(override.body).toMatchObject({ previous: "absent", session: { attendance: "present" } });
  });

  test("reschedule and cancel are refused once attendance is marked", async () => {
    const r = await request(app)
      .put(`/api/admin/counselling-sessions/${past.session_id}/reschedule`)
      .set(as(admin))
      .send({ scheduledAt: slot(25) });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already been marked/);
    const c = await request(app).put(`/api/admin/counselling-sessions/${past.session_id}/cancel`).set(as(admin)).send({ reason: "x" });
    expect(c.status).toBe(409);
  });

  test("reschedule moves an unmarked session (same rules)", async () => {
    const res = await request(app)
      .put(`/api/admin/counselling-sessions/${future.session_id}/reschedule`)
      .set(as(admin))
      .send({ scheduledAt: slot(23, 14, 0), durationMin: 45, mode: "online", location: "https://meet.example.com/abc" });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({ duration_min: 45, mode: "online", location: "https://meet.example.com/abc" });
    expect(res.body.session.when).toMatch(/2:00 PM$/);
    expect(res.body.previous.duration_min).toBe(30);
    const pastTime = await request(app)
      .put(`/api/admin/counselling-sessions/${future.session_id}/reschedule`)
      .set(as(admin))
      .send({ scheduledAt: new Date(Date.now() - DAY).toISOString() });
    expect(pastTime.status).toBe(400);
    // clash with another of Ayesha's sessions (slot(22) 11:00)
    const clash = await request(app)
      .put(`/api/admin/counselling-sessions/${future.session_id}/reschedule`)
      .set(as(admin))
      .send({ scheduledAt: slot(22, 11, 0) });
    expect(clash.status).toBe(409);
  });

  test("cancel needs a reason; a cancelled session can't be marked, rescheduled or cancelled again", async () => {
    const noReason = await request(app).put(`/api/admin/counselling-sessions/${cancelled.session_id}/cancel`).set(as(admin)).send({});
    expect(noReason.status).toBe(400);
    const ok = await request(app)
      .put(`/api/admin/counselling-sessions/${cancelled.session_id}/cancel`)
      .set(as(admin))
      .send({ reason: "Counsellor unavailable" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "cancelled", display_status: "cancelled", cancelled_reason: "Counsellor unavailable" });

    await moveToPast(cancelled.session_id, 60);
    const m = await mark(cancelled.session_id, ayesha, { attendance: "present" });
    expect(m.status).toBe(409);
    expect(m.body.error).toMatch(/cancelled/);
    const again = await request(app).put(`/api/admin/counselling-sessions/${cancelled.session_id}/cancel`).set(as(admin)).send({ reason: "x" });
    expect(again.status).toBe(409);
    const r = await request(app).put(`/api/admin/counselling-sessions/${cancelled.session_id}/reschedule`).set(as(admin)).send({ scheduledAt: slot(30) });
    expect(r.status).toBe(409);
  });

  test("a cancelled session frees the slot", async () => {
    // cancelled was moved to the past; book a new one where a cancelled session sits
    const c = (await book(base(A, { scheduledAt: slot(26) }))).body.session;
    await request(app).put(`/api/admin/counselling-sessions/${c.session_id}/cancel`).set(as(admin)).send({ reason: "Clash" });
    const res = await book(base(A, { scheduledAt: slot(26) }));
    expect(res.status).toBe(201);
  });

  test("unknown session -> 404, bad id -> 400", async () => {
    expect((await mark(99999999, ayesha, { attendance: "present" })).status).toBe(404);
    expect((await mark("abc", ayesha, { attendance: "present" })).status).toBe(400);
    expect((await mark(past.session_id, ayesha, { attendance: "late" })).status).toBe(400);
  });
});

describe("who sees what", () => {
  test("a student sees only their own sessions and never the counsellor's notes", async () => {
    const res = await request(app).get("/api/student/counselling-sessions").set(as(tokA));
    expect(res.status).toBe(200);
    const { rows } = await pool.query("SELECT session_id FROM counselling_sessions WHERE student_id = $1", [A.student_id]);
    expect(res.body.sessions.map((s) => s.session_id).sort()).toEqual(rows.map((r) => r.session_id).sort());
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/counsellor_notes|Discussed a study plan|marked_by|student_id/);
    expect(res.body.summary).toMatchObject({ attended: 1, missed: 0, marked: 1 });
    expect(res.body.next).toMatchObject({ display_status: "upcoming" });

    const other = await request(app).get("/api/student/counselling-sessions").set(as(tokB));
    const ownB = (await pool.query("SELECT session_id FROM counselling_sessions WHERE student_id = $1", [B.student_id])).rows.map((r) => r.session_id);
    expect(other.body.sessions.map((s) => s.session_id).sort()).toEqual(ownB.sort());
  });

  test("a teacher sees only their own sessions", async () => {
    const res = await request(app).get("/api/faculty/counselling-sessions?view=upcoming").set(as(zain));
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThan(0);
    expect(res.body.sessions.every((s) => s.faculty_id === zainId)).toBe(true);
    expect((await request(app).get("/api/faculty/counselling-sessions?view=everything").set(as(zain))).status).toBe(400);
  });

  test("admin list: filters, display status and pagination, newest first", async () => {
    const all = await request(app).get(`/api/admin/counselling-sessions?student=${A.student_id}&limit=100`).set(as(admin));
    expect(all.status).toBe(200);
    const times = all.body.rows.map((r) => new Date(r.scheduled_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(all.body.rows.every((r) => r.student_id === A.student_id)).toBe(true);

    const present = await request(app).get(`/api/admin/counselling-sessions?student=${A.student_id}&status=present`).set(as(admin));
    expect(present.body.total).toBe(1);
    const cancelled = await request(app).get(`/api/admin/counselling-sessions?search=${A.roll_no}&status=cancelled`).set(as(admin));
    expect(cancelled.body.rows.every((r) => r.display_status === "cancelled" && r.roll_no === A.roll_no)).toBe(true);
    const zainOnly = await request(app).get(`/api/admin/counselling-sessions?counsellor=${zainId}`).set(as(admin));
    expect(zainOnly.body.rows.every((r) => r.faculty_id === zainId)).toBe(true);

    const day = slot(10).slice(0, 10);
    const ranged = await request(app).get(`/api/admin/counselling-sessions?from=${day}&to=${day}&limit=100`).set(as(admin));
    expect(ranged.body.rows.length).toBeGreaterThanOrEqual(2);
    expect(ranged.body.rows.every((r) => r.when.includes(day.slice(8, 10).replace(/^0/, "")))).toBe(true);

    const page = await request(app).get(`/api/admin/counselling-sessions?student=${A.student_id}&limit=2&page=2`).set(as(admin));
    expect(page.body).toMatchObject({ page: 2, limit: 2, total: all.body.total });
    expect(page.body.rows.map((r) => r.session_id)).toEqual(all.body.rows.slice(2, 4).map((r) => r.session_id));

    expect((await request(app).get("/api/admin/counselling-sessions?status=late").set(as(admin))).status).toBe(400);
    expect((await request(app).get("/api/admin/counselling-sessions?from=2026-13-01").set(as(admin))).status).toBe(400);
  });

  test("admin-only routes refuse faculty and students; faculty routes refuse students", async () => {
    const routes = [
      ["post", "/api/admin/counselling-sessions"],
      ["get", "/api/admin/counselling-sessions"],
      ["put", "/api/admin/counselling-sessions/1/reschedule"],
      ["put", "/api/admin/counselling-sessions/1/cancel"],
      ["put", "/api/admin/counselling-sessions/1/attendance"],
    ];
    for (const [m, path] of routes) {
      for (const t of [ayesha, tokA]) expect((await request(app)[m](path).set(as(t)).send({})).status).toBe(403);
    }
    expect((await request(app).get("/api/faculty/counselling-sessions").set(as(tokA))).status).toBe(403);
    expect((await request(app).put("/api/faculty/counselling-sessions/1/attendance").set(as(tokA)).send({})).status).toBe(403);
    expect((await request(app).get("/api/student/counselling-sessions").set(as(ayesha))).status).toBe(403);
    // no delete route
    expect((await request(app).delete("/api/admin/counselling-sessions/1").set(as(admin))).status).toBe(404);
  });

  test("every write is in the audit log", async () => {
    const { rows } = await pool.query(
      `SELECT action, COUNT(*)::int AS n FROM audit_log
       WHERE entity = 'counselling_sessions' AND created_at >= $1
         AND entity_id IN (SELECT session_id FROM counselling_sessions WHERE student_id = ANY($2))
       GROUP BY action`,
      [since, [A.student_id, B.student_id]]
    );
    const n = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    expect(n.SCHEDULE_SESSION).toBeGreaterThanOrEqual(8);
    expect(n.RESCHEDULE_SESSION).toBe(1);
    expect(n.CANCEL_SESSION).toBe(2);
    expect(n.MARK_ATTENDANCE).toBe(3);
    const mark = await pool.query(
      `SELECT details FROM audit_log WHERE action = 'MARK_ATTENDANCE' AND created_at >= $1
         AND entity_id IN (SELECT session_id FROM counselling_sessions WHERE student_id = $2) ORDER BY log_id`,
      [since, A.student_id]
    );
    expect(mark.rows.map((r) => [r.details.previous, r.details.attendance, r.details.by])).toEqual([
      [null, "present", "counsellor"],
      ["present", "absent", "counsellor"],
      ["absent", "present", "admin"],
    ]);
    const reassign = await pool.query(
      "SELECT 1 FROM audit_log WHERE action = 'REASSIGN_COUNSELOR' AND created_at >= $1 AND details->>'via' = 'counselling_session'",
      [since]
    );
    expect(reassign.rows.length).toBe(1);
  });
});
