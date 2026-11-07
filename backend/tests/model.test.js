// Phase 5 ML transparency: the stored model_label is whatever the ML service said, an unreachable
// ML service gives source='fallback', and the what-if simulator never inserts a predictions row
// and respects ownership. The ML service is mocked (global fetch), so it need not be running.
const request = require("supertest");
const app = require("../src/app");
const { predictForStudent } = require("../src/services/predictionService");
const { applyOverrides, parseOverrides } = require("../src/services/whatIf");
const { login, studentId, pool } = require("./helpers");

const PRED_STUDENT = "BU-102451"; // an ordinary enrolled student (not a demo account)
const DEMO = "BU-100040"; // taught by ayesha.khan and zain.abbas
const as = (t) => ({ Authorization: `Bearer ${t}` });

const realFetch = global.fetch;
let fetchSpy;
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const mlResult = (label) => ({
  label,
  prob_safe: label === "Safe" ? 0.9 : 0.05,
  prob_at_risk: label === "At-Risk" ? 0.9 : 0.05,
  prob_dropout: label === "Dropout-Likely" ? 0.9 : 0.05,
  model_version: "mocked_v1",
  explanations: [{ feature: "CGPA", value: 2.5, shap: 0.2, direction: label === "Safe" ? "lowers_risk" : "raises_risk" }],
  base_value: 0.33,
});
/** Mock the ML service: /predict -> mlResult(label); /predict/batch -> one result per row. */
function mockMl(label) {
  fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/batch")) return jsonResponse({ results: body.rows.map(() => mlResult(label)) });
    return jsonResponse(mlResult(label));
  });
}
function mockMlDown() {
  fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
}
afterEach(() => {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = null;
  global.fetch = realFetch;
});

const predictionCount = async (sid) => (await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE student_id = $1", [sid])).rows[0].n;

describe("stored predictions come from the ML service", () => {
  let sid;
  let pointerBefore;
  const created = [];
  let warn;
  beforeAll(async () => {
    sid = await studentId(PRED_STUDENT);
    pointerBefore = (await pool.query("SELECT latest_prediction_id FROM students WHERE student_id = $1", [sid])).rows[0].latest_prediction_id;
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(async () => {
    warn.mockRestore();
    // put the pointer back, then remove the test rows
    await pool.query("UPDATE students SET latest_prediction_id = $2 WHERE student_id = $1", [sid, pointerBefore]);
    await pool.query("DELETE FROM predictions WHERE prediction_id = ANY($1)", [created]);
  });

  test.each(["Dropout-Likely", "At-Risk", "Safe"])("model says %s -> the stored model_label equals it, source model", async (label) => {
    mockMl(label);
    const row = await predictForStudent(sid, { trigger: "jest" });
    created.push(row.prediction_id);
    expect(row.model_label).toBe(label);
    expect(row.source).toBe("model");
    expect(row.model_version).toBe("mocked_v1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // the policy can only escalate: final is never less severe than the model
    const sev = { Safe: 0, "At-Risk": 1, "Dropout-Likely": 2 };
    expect(sev[row.final_label]).toBeGreaterThanOrEqual(sev[label]);
  });

  test("ML service unreachable -> source 'fallback', no drivers", async () => {
    mockMlDown();
    const row = await predictForStudent(sid, { trigger: "jest" });
    created.push(row.prediction_id);
    expect(row.source).toBe("fallback");
    expect(row.model_version).toBe("rule_fallback");
    expect(row.drivers).toBeNull();
  });
});

describe("what-if simulator", () => {
  let admin, ayesha, amina, student, sid;
  beforeAll(async () => {
    [admin, ayesha, amina, student] = await Promise.all([
      login(app, "admin@smartedu.edu", "admin"),
      login(app, "ayesha.khan@smartedu.edu", "faculty"),
      login(app, "amina.sheikh@smartedu.edu", "faculty"),
      login(app, "student100040@smartedu.edu", "student"),
    ]);
    sid = await studentId(DEMO);
  });

  const whatIf = (t, overrides, who = "faculty", id = sid) =>
    request(app).post(`/api/${who}/students/${id}/what-if`).set(as(t)).send({ overrides });

  test("never inserts a predictions row (faculty and admin)", async () => {
    mockMl("Dropout-Likely");
    const before = await predictionCount(sid);
    const pointer = (await pool.query("SELECT latest_prediction_id FROM students WHERE student_id = $1", [sid])).rows[0].latest_prediction_id;
    const res = await whatIf(ayesha, { Attendance_Percentage: 55 });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.scenario.model_label).toBe("Dropout-Likely");
    expect(res.body.inputs.after.Attendance_Percentage).toBe(55);
    expect((await whatIf(admin, { Final_Marks: 30 }, "admin")).status).toBe(200);
    expect(await predictionCount(sid)).toBe(before);
    const after = (await pool.query("SELECT latest_prediction_id FROM students WHERE student_id = $1", [sid])).rows[0].latest_prediction_id;
    expect(after).toBe(pointer);
  });

  test("one ML batch call scores baseline and scenario; offline -> fallback", async () => {
    mockMl("Safe");
    await whatIf(ayesha, { Quiz_Avg: 90 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/batch$/);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).rows).toHaveLength(2);
    fetchSpy.mockRestore();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockMlDown();
    const res = await whatIf(ayesha, { Attendance_Percentage: 55 });
    warn.mockRestore();
    expect(res.body.scenario.source).toBe("fallback");
    expect(res.body.scenario.final_label).toBe("Dropout-Likely"); // attendance < 60% rule
  });

  test("respects ownership and roles", async () => {
    mockMl("Safe");
    expect((await whatIf(amina, { Attendance_Percentage: 55 })).status).toBe(403); // not her student
    expect((await whatIf(student, { Attendance_Percentage: 55 })).status).toBe(403);
    expect((await whatIf(student, { Attendance_Percentage: 55 }, "admin")).status).toBe(403);
    expect((await whatIf(ayesha, {}, "admin")).status).toBe(403);
    expect((await whatIf(admin, { Attendance_Percentage: 55 }, "admin", 999999999)).status).toBe(404);
  });

  test("validates overrides", async () => {
    mockMl("Safe");
    expect((await whatIf(ayesha, { Attendance_Percentage: 120 })).status).toBe(400);
    expect((await whatIf(ayesha, { CGPA: 4 })).status).toBe(400); // not overridable
    expect((await request(app).post(`/api/faculty/students/${sid}/what-if`).set(as(ayesha)).send({})).status).toBe(400);
    expect((await whatIf(ayesha, {})).status).toBe(200); // empty: today's inputs only
  });

  test("mark overrides recompute provisional SGPA and projected CGPA", () => {
    const f = { Previous_SGPA: 2.0, SGPA: 2.5, CGPA: 2.25, Assignment_Avg: 70, Quiz_Avg: 70, Midterm_Marks: 70, Final_Marks: 70, Attendance_Percentage: 90 };
    const att = applyOverrides(f, { Attendance_Percentage: 50 });
    expect([att.SGPA, att.CGPA]).toEqual([2.5, 2.25]); // attendance alone keeps them
    const marks = applyOverrides(f, { Assignment_Avg: 90, Quiz_Avg: 90, Midterm_Marks: 90, Final_Marks: 90 });
    expect(marks.SGPA).toBeCloseTo(3.31, 2); // 0.064 x 90 - 2.453
    expect(marks.CGPA).toBeCloseTo((2.0 + marks.SGPA) / 2, 2);
    expect(() => parseOverrides({ overrides: { Quiz_Avg: "abc" } })).toThrow();
  });
});

describe("GET /api/admin/model", () => {
  test("returns the model card and live stats; ML offline still gives stats", async () => {
    const admin = await login(app, "admin@smartedu.edu", "admin");
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ model_type: "RandomForestClassifier", feature_names: Array(20).fill("x") }));
    const res = await request(app).get("/api/admin/model").set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.ml_online).toBe(true);
    expect(res.body.model.model_type).toBe("RandomForestClassifier");
    const s = res.body.stats;
    expect(s.students_with_prediction).toBeGreaterThan(0);
    expect(s.agreement.matrix).toHaveLength(3);
    expect(s.agreement.rate).toBeGreaterThan(0.9);
    expect(Object.keys(s.label_distribution)).toEqual(["Safe", "At-Risk", "Dropout-Likely"]);
    expect(res.body.limitations.early_warning_benchmark_macro_f1).toBe(0.934);
    fetchSpy.mockRestore();

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockMlDown();
    const off = await request(app).get("/api/admin/model").set(as(admin));
    warn.mockRestore();
    expect(off.status).toBe(200);
    expect(off.body.ml_online).toBe(false);
    expect(off.body.stats.students_with_prediction).toBeGreaterThan(0);

    const faculty = await login(app, "ayesha.khan@smartedu.edu", "faculty");
    expect((await request(app).get("/api/admin/model").set(as(faculty))).status).toBe(403);
  });
});

afterAll(() => pool.end());
