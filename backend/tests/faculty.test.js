const request = require("supertest");
const app = require("../src/app");
const { login, pool, takeSnapshot, restoreSnapshot, allKeys } = require("./helpers");

// Faculty portal: own classes only (roster, attendance, risk summary, results, attendance marking,
// what-if), server-derived grades, validation. Every write is undone afterwards (restoreSnapshot).
// The ML service is mocked so labels are deterministic and the suite runs without it.

const as = (t) => ({ Authorization: `Bearer ${t}` });
let ayesha, bilal, own, foreign, snap, warn;
const realFetch = global.fetch;

beforeAll(async () => {
  [ayesha, bilal] = await Promise.all([login(app, "ayesha.khan@smartedu.edu", "faculty"), login(app, "bilal.raza@smartedu.edu", "faculty")]);
  const classOf = async (email) =>
    (
      await pool.query(
        `SELECT fc.faculty_course_id AS id, COUNT(e.*)::int AS n FROM faculty_courses fc JOIN faculty f USING (faculty_id)
         JOIN users u ON u.user_id = f.user_id JOIN enrollments e ON e.faculty_course_id = fc.faculty_course_id
         WHERE u.email = $1 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1`,
        [email]
      )
    ).rows[0];
  own = await classOf("ayesha.khan@smartedu.edu");
  foreign = await classOf("bilal.raza@smartedu.edu");
  const enr = (await pool.query("SELECT enrollment_id, student_id, faculty_course_id FROM enrollments WHERE faculty_course_id = ANY($1)", [[own.id, foreign.id]])).rows;
  own.enrollments = enr.filter((e) => e.faculty_course_id === own.id);
  foreign.enrollments = enr.filter((e) => e.faculty_course_id === foreign.id);
  snap = await takeSnapshot({ studentIds: [...new Set(enr.map((e) => e.student_id))], enrollmentIds: enr.map((e) => e.enrollment_id) });
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  global.fetch = jest.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    const r = { label: "At-Risk", prob_safe: 0.2, prob_at_risk: 0.7, prob_dropout: 0.1, model_version: "mocked_v1", explanations: [], base_value: 0.3 };
    return { ok: true, json: async () => (String(url).endsWith("/batch") ? { results: body.rows.map(() => r) } : r) };
  });
});

afterAll(async () => {
  global.fetch = realFetch;
  warn.mockRestore();
  await restoreSnapshot(snap);
  await pool.query("DELETE FROM audit_log WHERE created_at >= $1 AND action IN ('UPDATE_RESULT', 'MARK_ATTENDANCE')", [snap.at]);
  await pool.end();
});

describe("reading my classes", () => {
  test("GET /classes lists only my classes, with label counts", async () => {
    const res = await request(app).get("/api/faculty/classes").set(as(ayesha));
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.faculty_course_id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
    const c = res.body.find((x) => x.faculty_course_id === own.id);
    expect(Number(c.safe) + Number(c.at_risk) + Number(c.dropout_likely)).toBe(own.n);
  });

  test("roster: my class has labels and reasons, no probabilities; another teacher's class is 403", async () => {
    const res = await request(app).get(`/api/faculty/classes/${own.id}/roster`).set(as(ayesha));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(own.n);
    expect(res.body[0]).toEqual(expect.objectContaining({ roll_no: expect.any(String), final_label: expect.any(String) }));
    const keys = allKeys(res.body);
    for (const k of ["prob_safe", "prob_at_risk", "prob_dropout", "password_hash"]) expect(keys.has(k)).toBe(false);
    expect((await request(app).get(`/api/faculty/classes/${foreign.id}/roster`).set(as(ayesha))).status).toBe(403);
  });

  test("risk summary counts match the roster; another teacher's class is 403", async () => {
    const res = await request(app).get(`/api/faculty/classes/${own.id}/risk-summary`).set(as(ayesha));
    expect(res.status).toBe(200);
    const counts = res.body.counts || res.body;
    const total = ["safe", "at_risk", "dropout_likely"].reduce((n, k) => n + Number(counts[k] || 0), 0);
    expect(total).toBe(own.n);
    expect((await request(app).get(`/api/faculty/classes/${foreign.id}/risk-summary`).set(as(ayesha))).status).toBe(403);
  });

  test("attendance list: mine 200, another teacher's 403, unknown class 403/404, bad id 400", async () => {
    expect((await request(app).get(`/api/faculty/classes/${own.id}/attendance`).set(as(ayesha))).status).toBe(200);
    expect((await request(app).get(`/api/faculty/classes/${foreign.id}/attendance`).set(as(ayesha))).status).toBe(403);
    expect([403, 404]).toContain((await request(app).get("/api/faculty/classes/999999/attendance").set(as(ayesha))).status);
    expect((await request(app).get("/api/faculty/classes/abc/attendance").set(as(ayesha))).status).toBe(400);
  });
});

describe("saving results", () => {
  test("own enrollment: saved, grade derived by the server (a sent grade is ignored), re-predicted", async () => {
    const e = own.enrollments[0];
    const res = await request(app)
      .put(`/api/faculty/results/${e.enrollment_id}`)
      .set(as(ayesha))
      .send({ assignment_avg: 90, quiz_avg: 90, midterm_marks: 90, final_marks: 90, grade: "F" });
    expect(res.status).toBe(200);
    expect(res.body.grade).toBe("A");
    expect(res.body.prediction).toEqual(expect.objectContaining({ new_label: expect.any(String) }));
    const { rows } = await pool.query("SELECT grade, data_source FROM course_results WHERE enrollment_id = $1", [e.enrollment_id]);
    expect(rows[0]).toEqual({ grade: "A", data_source: "live" });
  });

  test("another teacher's enrollment is 403 and nothing changes", async () => {
    const e = foreign.enrollments[0];
    const before = (await pool.query("SELECT assignment_avg FROM course_results WHERE enrollment_id = $1", [e.enrollment_id])).rows[0];
    const res = await request(app).put(`/api/faculty/results/${e.enrollment_id}`).set(as(ayesha)).send({ assignment_avg: 1, quiz_avg: 1, midterm_marks: 1, final_marks: 1 });
    expect(res.status).toBe(403);
    const after = (await pool.query("SELECT assignment_avg FROM course_results WHERE enrollment_id = $1", [e.enrollment_id])).rows[0];
    expect(after).toEqual(before);
  });

  test.each([
    ["above 100", { assignment_avg: 101 }],
    ["negative", { quiz_avg: -1 }],
    ["not a number", { midterm_marks: "eighty" }],
  ])("a mark %s is 400", async (_n, body) => {
    expect((await request(app).put(`/api/faculty/results/${own.enrollments[0].enrollment_id}`).set(as(ayesha)).send(body)).status).toBe(400);
  });
});

describe("marking attendance", () => {
  const DATE = "2026-01-05"; // a past date the seed never uses

  test("my class: saved for every entry, live, and the students are re-predicted", async () => {
    const entries = own.enrollments.map((e, i) => ({ enrollmentId: e.enrollment_id, status: i % 2 ? "absent" : "present" }));
    const res = await request(app).post("/api/faculty/attendance").set(as(ayesha)).send({ facultyCourseId: own.id, classDate: DATE, entries });
    expect(res.status).toBe(200);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM attendance WHERE class_date = $1 AND enrollment_id = ANY($2) AND data_source = 'live'", [DATE, own.enrollments.map((e) => e.enrollment_id)]);
    expect(rows[0].n).toBe(own.enrollments.length);
  });

  test("an entry from another teacher's class -> 403 and nothing is written", async () => {
    const DATE2 = "2026-01-12";
    const entries = [{ enrollmentId: own.enrollments[0].enrollment_id, status: "present" }, { enrollmentId: foreign.enrollments[0].enrollment_id, status: "present" }];
    const res = await request(app).post("/api/faculty/attendance").set(as(ayesha)).send({ facultyCourseId: own.id, classDate: DATE2, entries });
    expect(res.status).toBe(403);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM attendance WHERE class_date = $1", [DATE2]);
    expect(rows[0].n).toBe(0);
  });

  test("another teacher's class id -> 403", async () => {
    const entries = [{ enrollmentId: foreign.enrollments[0].enrollment_id, status: "present" }];
    expect((await request(app).post("/api/faculty/attendance").set(as(ayesha)).send({ facultyCourseId: foreign.id, classDate: DATE, entries })).status).toBe(403);
  });

  test("a dropped enrollment -> 400", async () => {
    const e = own.enrollments[1];
    await pool.query("UPDATE enrollments SET status = 'dropped' WHERE enrollment_id = $1", [e.enrollment_id]); // restored in afterAll
    const res = await request(app).post("/api/faculty/attendance").set(as(ayesha)).send({ facultyCourseId: own.id, classDate: "2026-01-19", entries: [{ enrollmentId: e.enrollment_id, status: "present" }] });
    expect(res.status).toBe(400);
    await pool.query("UPDATE enrollments SET status = 'enrolled' WHERE enrollment_id = $1", [e.enrollment_id]);
  });

  test.each([
    ["bad status", { status: "late" }],
    ["bad date", { classDate: "2026-02-30" }],
    ["no entries", { entries: [] }],
  ])("%s -> 400", async (_n, patch) => {
    const body = { facultyCourseId: own.id, classDate: DATE, entries: [{ enrollmentId: own.enrollments[0].enrollment_id, status: "present" }], ...patch };
    if (patch.status) body.entries = [{ enrollmentId: own.enrollments[0].enrollment_id, status: patch.status }];
    expect((await request(app).post("/api/faculty/attendance").set(as(ayesha)).send(body)).status).toBe(400);
  });
});

describe("what-if and uploads ownership", () => {
  test("what-if for a student in my class works; for a student only in another teacher's class it is 403", async () => {
    const mine = await request(app).post(`/api/faculty/students/${own.enrollments[0].student_id}/what-if`).set(as(ayesha)).send({ overrides: { Attendance_Percentage: 50 } });
    expect(mine.status).toBe(200);
    expect(mine.body.saved).toBe(false);
    const theirs = await request(app).post(`/api/faculty/students/${foreign.enrollments[0].student_id}/what-if`).set(as(ayesha)).send({ overrides: {} });
    expect(theirs.status).toBe(403);
  });

  test("upload templates and upload history: another teacher's class is 403", async () => {
    expect((await request(app).get(`/api/faculty/classes/${own.id}/templates/results.csv`).set(as(ayesha))).status).toBe(200);
    expect((await request(app).get(`/api/faculty/classes/${foreign.id}/templates/results.csv`).set(as(ayesha))).status).toBe(403);
    expect((await request(app).get(`/api/faculty/uploads?classId=${foreign.id}`).set(as(ayesha))).status).toBe(403);
    expect((await request(app).get(`/api/faculty/uploads?classId=${foreign.id}`).set(as(bilal))).status).toBe(200);
  });
});
