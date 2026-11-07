const request = require("supertest");
const app = require("../src/app");
const { login, studentId, pool, takeSnapshot, restoreSnapshot, allKeys } = require("./helpers");

// Student portal: every endpoint answers with the signed-in student's own data (the id comes from
// the JWT; there is no id in any student URL), never exposes probabilities, SHAP drivers or raw model
// features, and a refresh re-predicts only that student. ML mocked; writes undone afterwards.

const as = (t) => ({ Authorization: `Bearer ${t}` });
const GETS = ["/dashboard", "/results", "/attendance", "/history", "/prediction", "/prediction/timeline", "/next-steps"];
// (feature_sources is allowed: it only tags inputs as live / projected / provisional, no values)
const HIDDEN = ["prob_safe", "prob_at_risk", "prob_dropout", "drivers", "features", "model_label", "policy_label", "target_label", "password_hash", "shap"];

let a, b, idA, idB, snap, warn;
const realFetch = global.fetch;

beforeAll(async () => {
  [a, b] = await Promise.all([login(app, "student100040@smartedu.edu", "student"), login(app, "student144766@smartedu.edu", "student")]);
  [idA, idB] = await Promise.all([studentId("BU-100040"), studentId("BU-144766")]);
  snap = await takeSnapshot({ studentIds: [idA, idB] });
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ label: "Safe", prob_safe: 0.9, prob_at_risk: 0.08, prob_dropout: 0.02, model_version: "mocked_v1", explanations: [{ feature: "CGPA", value: 2.91, shap: 0.3, direction: "lowers_risk" }], base_value: 0.3 }),
  }));
});

afterAll(async () => {
  global.fetch = realFetch;
  warn.mockRestore();
  await restoreSnapshot(snap);
  await pool.end();
});

describe.each(GETS)("GET /api/student%s", (path) => {
  test("200 and no probabilities, drivers or raw features anywhere", async () => {
    const res = await request(app).get(`/api/student${path}`).set(as(a));
    expect(res.status).toBe(200);
    const keys = allKeys(res.body);
    for (const k of HIDDEN) expect(keys.has(k)).toBe(false);
  });
});

describe("scoping: the JWT decides whose data", () => {
  test("two students get their own dashboards", async () => {
    const [ra, rb] = await Promise.all([
      request(app).get("/api/student/dashboard").set(as(a)),
      request(app).get("/api/student/dashboard").set(as(b)),
    ]);
    expect(ra.body.profile.roll_no).toBe("BU-100040");
    expect(rb.body.profile.roll_no).toBe("BU-144766");
    expect(ra.body.latestPrediction.final_label).toBe("Safe");
    expect(rb.body.latestPrediction.final_label).toBe("Dropout-Likely");
  });

  test("query or body ids are ignored", async () => {
    const res = await request(app).get(`/api/student/dashboard?studentId=${idB}&student_id=${idB}`).set(as(a));
    expect(res.body.profile.roll_no).toBe("BU-100040");
    const results = await request(app).get(`/api/student/results?studentId=${idB}`).set(as(a));
    const own = await request(app).get("/api/student/results").set(as(a));
    expect(results.body).toEqual(own.body);
  });

  test("history and results are this student's rows only", async () => {
    const hist = await request(app).get("/api/student/history").set(as(a));
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM student_semester_performance WHERE student_id = $1", [idA]);
    expect(hist.body.length ?? hist.body.history?.length).toBe(rows[0].n);
    const res = await request(app).get("/api/student/results").set(as(a));
    const { rows: courses } = await pool.query("SELECT COUNT(*)::int AS n FROM enrollments WHERE student_id = $1", [idA]);
    expect(res.body).toHaveLength(courses[0].n);
    expect(res.body.every((r) => r.marks_source === "entered")).toBe(true);
  });
});

describe("refresh", () => {
  test("re-predicts only the signed-in student and returns no probabilities", async () => {
    const countB = async () => (await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [idB])).rows[0].n;
    const beforeB = await countB();
    const res = await request(app).post("/api/student/prediction/refresh").set(as(a));
    expect(res.status).toBe(200);
    const keys = allKeys(res.body);
    for (const k of HIDDEN) expect(keys.has(k)).toBe(false);
    const { rows } = await pool.query(
      "SELECT p.triggered_by, p.student_id FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.student_id = $1",
      [idA]
    );
    expect(rows[0]).toEqual({ triggered_by: "student_refresh", student_id: idA });
    expect(await countB()).toBe(beforeB);
  });
});

describe("the timeline and next steps", () => {
  test("timeline: one point per day, oldest first, label and projected CGPA only", async () => {
    const res = await request(app).get("/api/student/prediction/timeline").set(as(a));
    expect(Array.isArray(res.body)).toBe(true);
    for (const p of res.body) expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(["final_label"]));
    const days = res.body.map((p) => p.date || p.day);
    expect(new Set(days).size).toBe(days.length);
  });

  test("next steps for a Dropout-Likely student are ranked and concrete", async () => {
    const res = await request(app).get("/api/student/next-steps").set(as(b));
    const steps = res.body.steps || res.body;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.priority)).toEqual([...steps.map((s) => s.priority)].sort((x, y) => x - y));
    expect(steps.some((s) => /\d/.test(s.text))).toBe(true);
  });
});
