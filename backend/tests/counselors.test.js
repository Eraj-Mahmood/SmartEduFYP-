const request = require("supertest");
const app = require("../src/app");
const { login, studentId, pool } = require("./helpers");

// Counselor assignments (FR12). The counselee is an ordinary enrolled student (BU-100008), not
// one of the six demo accounts; everything the tests create is removed afterwards.
const STUDENT = { roll: "BU-100008", email: "student100008@smartedu.edu" };
const OTHER_STUDENT = { roll: "BU-100040", email: "student100040@smartedu.edu" }; // must not see the counselor
const AYESHA = "ayesha.khan@smartedu.edu";
const ZAIN = "zain.abbas@smartedu.edu";
const since = new Date();

let admin, ayesha, zain, student, other, sid, ayeshaId, zainId;
const as = (t) => ({ Authorization: `Bearer ${t}` });

async function facultyId(email) {
  const { rows } = await pool.query("SELECT f.faculty_id FROM faculty f JOIN users u ON u.user_id = f.user_id WHERE u.email = $1", [email]);
  return rows[0].faculty_id;
}

beforeAll(async () => {
  [admin, ayesha, zain, student, other] = await Promise.all([
    login(app, "admin@smartedu.edu", "admin"),
    login(app, AYESHA, "faculty"),
    login(app, ZAIN, "faculty"),
    login(app, STUDENT.email, "student"),
    login(app, OTHER_STUDENT.email, "student"),
  ]);
  sid = await studentId(STUDENT.roll);
  [ayeshaId, zainId] = await Promise.all([facultyId(AYESHA), facultyId(ZAIN)]);
  await pool.query("DELETE FROM counselor_assignments WHERE student_id = $1", [sid]);
});

afterAll(async () => {
  const { rows } = await pool.query("SELECT id FROM counselor_assignments WHERE student_id = $1 AND created_at >= $2", [sid, since]);
  const ids = rows.map((r) => r.id);
  await pool.query("DELETE FROM audit_log WHERE entity = 'counselor_assignments' AND entity_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM counselor_assignments WHERE id = ANY($1)", [ids]);
  await pool.query(
    `DELETE FROM notifications WHERE sent_at >= $1 AND (subject IN ('Your academic counselor', 'New counselee'))
       AND recipient_user_id IN (SELECT user_id FROM students WHERE student_id = $2
                                 UNION SELECT user_id FROM faculty WHERE faculty_id = ANY($3))`,
    [since, sid, [ayeshaId, zainId]]
  );
  await pool.end();
});

const assign = (facultyId) => request(app).post("/api/admin/counselors").set(as(admin)).send({ studentId: sid, facultyId });

describe("counselor workflow", () => {
  let first, second;

  test("assign links the latest prediction and notifies both people", async () => {
    const res = await assign(ayeshaId);
    expect(res.status).toBe(201);
    first = res.body;
    const { rows } = await pool.query("SELECT latest_prediction_id FROM students WHERE student_id = $1", [sid]);
    expect(first).toMatchObject({ status: "active", faculty_id: ayeshaId, prediction_id: rows[0].latest_prediction_id });

    const sn = await request(app).get("/api/notifications/mine").set(as(student));
    expect(sn.body.notifications[0].message).toMatch(/^Dr\. Ayesha Khan is now your academic counselor/);
    const fn = await request(app).get("/api/notifications/mine").set(as(ayesha));
    expect(fn.body.notifications[0].message).toMatch(/^You've been assigned as counselor to .+ \((Safe|At-Risk|Dropout-Likely)\)\.$/);
    expect(fn.body.notifications[0].link).toBe(`/faculty/counselees?open=${first.id}`);
  });

  test("the student sees their counselor on the dashboard; another student does not", async () => {
    const mine = await request(app).get("/api/student/dashboard").set(as(student));
    expect(mine.body.counselor).toMatchObject({ name: "Dr. Ayesha Khan", email: AYESHA, designation: "Associate Professor" });
    const theirs = await request(app).get("/api/student/dashboard").set(as(other));
    expect(theirs.body.counselor?.name).not.toBe("Dr. Ayesha Khan");
    const chat = await request(app).post("/api/student/chat").set(as(student)).send({ message: "Who can help me?" });
    expect(chat.body.answer).toContain("Dr. Ayesha Khan");
    await pool.query("DELETE FROM chat_messages WHERE student_id = $1 AND created_at >= $2", [sid, since]);
  });

  test("the counselor sees the summary; another faculty member gets 403", async () => {
    const list = await request(app).get("/api/faculty/counselees").set(as(ayesha));
    const me = list.body.find((c) => c.id === first.id);
    expect(me).toMatchObject({ roll_no: STUDENT.roll, last_contacted_at: null });
    expect(me).toHaveProperty("final_label");
    expect(Array.isArray(me.reasons)).toBe(true);
    expect(Array.isArray(me.next_steps)).toBe(true);
    // staff wording: describes the student, never addresses them
    expect(me.next_steps.length).toBeGreaterThan(0);
    for (const s of me.next_steps) expect(s.text).not.toMatch(/\b(your|you)\b/i);
    expect(me.next_steps.map((s) => s.text).join(" ")).toMatch(/Needs |Attendance |Weakest course /);
    expect(me).not.toHaveProperty("features");
    expect(me).not.toHaveProperty("drivers");

    expect((await request(app).get(`/api/faculty/counselees/${first.id}`).set(as(zain))).status).toBe(403);
    expect((await request(app).put(`/api/faculty/counselees/${first.id}`).set(as(zain)).send({ notes: "x" })).status).toBe(403);
    expect((await request(app).get("/api/faculty/counselees").set(as(zain))).body.find((c) => c.id === first.id)).toBeUndefined();
  });

  test("the admin student view has staff next steps and the counselor", async () => {
    const res = await request(app).get(`/api/admin/students/${sid}/full`).set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.counselor).toMatchObject({ faculty_id: ayeshaId });
    expect(res.body.nextSteps.length).toBeGreaterThan(0);
    for (const s of res.body.nextSteps) expect(s.text).not.toMatch(/\b(your|you)\b/i);
    expect((await request(app).get("/api/admin/students/999999999/full").set(as(admin))).status).toBe(404);
    expect((await request(app).get("/api/admin/students/abc/full").set(as(admin))).status).toBe(400);
  });

  test("the counselor can save notes and the contact date", async () => {
    const when = new Date().toISOString();
    const res = await request(app).put(`/api/faculty/counselees/${first.id}`).set(as(ayesha)).send({ notes: "Met after class.", last_contacted_at: when });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("Met after class.");
    expect(new Date(res.body.last_contacted_at).toISOString()).toBe(when);
    const future = new Date(Date.now() + 864e5).toISOString();
    expect((await request(app).put(`/api/faculty/counselees/${first.id}`).set(as(ayesha)).send({ last_contacted_at: future })).status).toBe(400);
  });

  test("the same counselor again is 409; reassigning closes the old one", async () => {
    expect((await assign(ayeshaId)).status).toBe(409);
    const res = await assign(zainId);
    expect(res.status).toBe(201);
    second = res.body;
    expect(second.closed_assignment_id).toBe(first.id);
    const { rows } = await pool.query("SELECT id, status, closed_at FROM counselor_assignments WHERE student_id = $1 ORDER BY id", [sid]);
    expect(rows.filter((r) => r.status === "active").map((r) => r.id)).toEqual([second.id]);
    expect(rows.find((r) => r.id === first.id).closed_at).not.toBeNull();
    // Ayesha lost access with the reassignment
    expect((await request(app).get(`/api/faculty/counselees/${first.id}`).set(as(ayesha))).status).toBe(403);
  });

  test("the database allows only one active assignment per student", async () => {
    await expect(
      pool.query("INSERT INTO counselor_assignments (student_id, faculty_id) VALUES ($1, $2)", [sid, ayeshaId])
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("workload counts active counselees; the list filters by status and faculty", async () => {
    const w = await request(app).get("/api/admin/faculty/workload").set(as(admin));
    expect(w.body.find((f) => f.faculty_id === zainId).active_counselees).toBeGreaterThanOrEqual(1);
    const l = await request(app).get(`/api/admin/counselors?status=active&faculty=${zainId}`).set(as(admin));
    expect(l.body.rows.map((r) => r.id)).toContain(second.id);
    expect(l.body).toHaveProperty("totalPages");
  });

  test("admin close works once; the audit log has the history", async () => {
    const c = await request(app).put(`/api/admin/counselors/${second.id}/close`).set(as(admin));
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("closed");
    expect((await request(app).put(`/api/admin/counselors/${second.id}/close`).set(as(admin))).status).toBe(409);
    const dash = await request(app).get("/api/student/dashboard").set(as(student));
    expect(dash.body.counselor).toBeNull();

    const log = await pool.query(
      "SELECT action FROM audit_log WHERE entity = 'counselor_assignments' AND entity_id = ANY($1) ORDER BY log_id",
      [[first.id, second.id]]
    );
    expect(log.rows.map((r) => r.action)).toEqual(["ASSIGN_COUNSELOR", "UPDATE_COUNSELEE", "REASSIGN_COUNSELOR", "CLOSE_COUNSELOR"]);
  });

  test("faculty and students can't use the admin counselor API", async () => {
    expect((await request(app).post("/api/admin/counselors").set(as(ayesha)).send({ studentId: sid, facultyId: ayeshaId })).status).toBe(403);
    expect((await request(app).get("/api/admin/counselors").set(as(student))).status).toBe(403);
  });
});
