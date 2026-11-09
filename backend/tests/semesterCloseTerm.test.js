const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");
const { getRun } = require("../src/services/predictionRuns");
const { buildFeatures } = require("../src/services/featureBuilder");

// Phase 7.1 Bugs 1 and 2: a semester close ENDS the term.
//   Bug 1 - the closed term's enrolments become 'completed', so their marks are not counted again as
//           "this term" (projected CGPA = official CGPA, no "two consecutive low terms" from one term,
//           a second close has nothing to close, completed classes take no marks or attendance).
//   Bug 2 - a student in their programme's final semester is not moved past it, and the model never
//           gets Semester > 8.
// The close changes real rows, so everything is put back afterwards (students' columns, prediction
// pointers, enrolment statuses, the close and everything hanging off it).
const as = (t) => ({ Authorization: `Bearer ${t}` });
const since = new Date();
const TERM = `Jest Term ${Date.now()}`;
const BUSHRA = "BU-114400";
let admin, scope, studentsBefore, enrolmentsBefore, closeResult, bushraBefore, finalYear;

const preview = (body) => request(app).post("/api/admin/semester-close/preview").set(as(admin)).send(body);
const confirm = (body) => request(app).post("/api/admin/semester-close/confirm").set(as(admin)).send(body);

async function waitForRun(id) {
  let run;
  for (let i = 0; i < 300; i++) {
    run = await getRun(id);
    if (!run || (run.status !== "running" && run.status !== "queued")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return run;
}

async function mlOnline() {
  const url = (process.env.ML_SERVICE_URL || "http://localhost:8001/predict").replace(/\/predict$/, "/health");
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
  scope = (await preview({ termLabel: TERM })).body.students.map((s) => s.student_id);
  studentsBefore = (
    await pool.query("SELECT student_id, cgpa, current_semester, academic_status, probation_count, latest_prediction_id FROM students WHERE student_id = ANY($1)", [scope])
  ).rows;
  enrolmentsBefore = (await pool.query("SELECT enrollment_id, status FROM enrollments WHERE student_id = ANY($1)", [scope])).rows;
  const b = await pool.query(
    `SELECT s.student_id, p.final_label FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.roll_no = $1`,
    [BUSHRA]
  );
  bushraBefore = b.rows[0];
  // a student enrolled this term who is already in the final semester of an 8-semester programme
  finalYear = studentsBefore.find((s) => s.current_semester === 8);

  const res = await confirm({ termLabel: TERM, resultsFinal: true });
  closeResult = res.body;
  if (res.status !== 201) throw new Error(`close failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (closeResult.run && closeResult.run.id) await waitForRun(closeResult.run.id);
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const s of studentsBefore) {
      await c.query(
        "UPDATE students SET cgpa = $2, current_semester = $3, academic_status = $4, probation_count = $5, latest_prediction_id = $6 WHERE student_id = $1",
        [s.student_id, s.cgpa, s.current_semester, s.academic_status, s.probation_count, s.latest_prediction_id]
      );
    }
    for (const e of enrolmentsBefore) await c.query("UPDATE enrollments SET status = $2 WHERE enrollment_id = $1", [e.enrollment_id, e.status]);
    await c.query("DELETE FROM predictions WHERE student_id = ANY($1) AND created_at >= $2", [scope, since]);
    await c.query("DELETE FROM prediction_runs WHERE started_at >= $1 AND scope = 'student'", [since]);
    await c.query("DELETE FROM student_semester_performance WHERE student_id = ANY($1) AND created_at >= $2", [scope, since]);
    await c.query("DELETE FROM semester_closes WHERE term_label LIKE 'Jest Term %'");
    await c.query("DELETE FROM notifications WHERE kind = 'standing' AND sent_at >= $1", [since]);
    await c.query("DELETE FROM uploads WHERE created_at >= $1", [since]);
    await c.query(
      "DELETE FROM audit_log WHERE created_at >= $1 AND action IN ('CLOSE_SEMESTER', 'UPLOAD_RESULTS', 'UPLOAD_ATTENDANCE')",
      [since]
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  await pool.end();
});

describe("Bug 1: a close ends the term", () => {
  test("the closed term's enrolments are 'completed'; dropped ones stay dropped", async () => {
    const { rows } = await pool.query("SELECT enrollment_id, status FROM enrollments WHERE student_id = ANY($1)", [scope]);
    const before = new Map(enrolmentsBefore.map((e) => [e.enrollment_id, e.status]));
    for (const r of rows) expect(r.status).toBe(before.get(r.enrollment_id) === "dropped" ? "dropped" : "completed");
  });

  test("after the close every student's projected CGPA equals the official CGPA (no current-term data)", async () => {
    const { rows } = await pool.query("SELECT student_id, cgpa FROM students WHERE student_id = ANY($1)", [scope]);
    for (const r of rows) {
      const built = await buildFeatures(r.student_id);
      expect(built.sources.CGPA).toBeUndefined(); // nothing "projected" any more
      expect(built.features.CGPA).toBeCloseTo(Number(r.cgpa), 2);
    }
  });

  test("Bushra: dashboard projected = official; no 'two consecutive low terms' from one term; label not raised", async () => {
    const tok = await login(app, "student114400@smartedu.edu", "student");
    const d = (await request(app).get("/api/student/dashboard").set(as(tok))).body;
    expect(d.officialCgpa.value).toBeCloseTo(1.97, 2);
    expect(d.projectedCgpa.value).toBeCloseTo(d.officialCgpa.value, 2);
    expect(d.previousSgpa.value).not.toBeCloseTo(d.provisionalSgpa.value, 2); // not the same term twice
    expect(d.latestPrediction.policy_reason || "").not.toMatch(/consecutive/i);
    expect(d.latestPrediction.final_label).toBe(bushraBefore.final_label);
    const built = await buildFeatures(bushraBefore.student_id);
    expect(built.features.Previous_SGPA).not.toBeCloseTo(built.features.SGPA, 2);
  });

  test("a second close without new enrolments is refused: nothing to close", async () => {
    const p = await preview({ termLabel: `${TERM} B` });
    expect(p.body.total).toBe(0);
    const res = await confirm({ termLabel: `${TERM} B`, resultsFinal: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to close/i);
  });

  test("a completed class takes no marks, attendance or uploads (400 with a clear message)", async () => {
    const { rows } = await pool.query(
      `SELECT e.enrollment_id, e.faculty_course_id, s.roll_no, u.email
       FROM enrollments e JOIN students s ON s.student_id = e.student_id
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN faculty f ON f.faculty_id = fc.faculty_id JOIN users u ON u.user_id = f.user_id
       WHERE e.status = 'completed' AND e.student_id = ANY($1) ORDER BY e.enrollment_id LIMIT 1`,
      [scope]
    );
    const e = rows[0];
    const fac = await login(app, e.email, "faculty");
    const marks = await request(app).put(`/api/faculty/results/${e.enrollment_id}`).set(as(fac)).send({ final_marks: 90 });
    expect(marks.status).toBe(400);
    expect(marks.body.error).toMatch(/completed/i);
    const att = await request(app)
      .post("/api/faculty/attendance")
      .set(as(fac))
      .send({ facultyCourseId: e.faculty_course_id, classDate: "2026-11-02", entries: [{ enrollmentId: e.enrollment_id, status: "present" }] });
    expect(att.status).toBe(400);
    expect(att.body.error).toMatch(/completed/i);
    const csv = `roll_no,name,assignment_avg,quiz_avg,midterm_marks,final_marks\n${e.roll_no},x,80,80,80,80\n`;
    const up = await request(app)
      .post(`/api/faculty/classes/${e.faculty_course_id}/upload?kind=results&mode=preview`)
      .set(as(fac))
      .attach("file", Buffer.from(csv), "marks.csv");
    expect(up.status).toBe(200);
    expect(up.body.summary.rows_ok).toBe(0);
    expect(up.body.errors[0].message).toMatch(/completed/i);
    // the class roster is empty now (only 'enrolled' counts as this term)
    const roster = await request(app).get(`/api/faculty/classes/${e.faculty_course_id}/roster`).set(as(fac));
    expect(roster.body.find((r) => r.roll_no === e.roll_no)).toBeUndefined();
  });
});

describe("Bug 2: the final semester is not passed", () => {
  test("a semester-8 student keeps semester 8, the standing row says final semester completed, and the model scores them", async () => {
    expect(finalYear).toBeDefined(); // BU-100040 and others are in semester 8 in the demo data
    const { rows } = await pool.query("SELECT current_semester FROM students WHERE student_id = $1", [finalYear.student_id]);
    expect(rows[0].current_semester).toBe(8);
    const st = await pool.query(
      `SELECT a.final_semester_completed FROM academic_standing a JOIN semester_closes sc ON sc.id = a.close_id
       WHERE a.student_id = $1 AND sc.term_label = $2`,
      [finalYear.student_id, TERM]
    );
    expect(st.rows[0].final_semester_completed).toBe(true);
    const built = await buildFeatures(finalYear.student_id);
    expect(built.features.Semester).toBeLessThanOrEqual(8);
    const p = await pool.query(
      "SELECT p.source, p.features FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE s.student_id = $1",
      [finalYear.student_id]
    );
    expect(Number(p.rows[0].features.Semester)).toBeLessThanOrEqual(8);
    if (await mlOnline()) expect(p.rows[0].source).toBe("model");
  });

  test("nobody is moved past semester 8", async () => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE student_id = ANY($1) AND current_semester > 8", [scope]);
    expect(rows[0].n).toBe(0);
  });
});
