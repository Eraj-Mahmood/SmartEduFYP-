const request = require("supertest");
const app = require("../src/app");
const { login, studentId, pool, takeSnapshot, restoreSnapshot, allKeys } = require("./helpers");
const { passwordProblems } = require("../src/controllers/authController");

// Admin portal: user provisioning, courses / classes / enrollments, directory and drill-down,
// the flagged list (filters, sorting, paging), dashboard KPIs and batch prediction runs (ML mocked).
// Everything created here is removed again.

const as = (t) => ({ Authorization: `Bearer ${t}` });
const TAG = `J${Date.now().toString().slice(-6)}`;
let admin, adminId;
const made = { users: [], courses: [] };

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
  adminId = (await pool.query("SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'")).rows[0].user_id;
});

afterAll(async () => {
  await pool.query("DELETE FROM audit_log WHERE actor_user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour' AND (details::text LIKE $2 OR entity_id = ANY($3))", [adminId, `%${TAG}%`, made.users]);
  await pool.query("DELETE FROM users WHERE user_id = ANY($1)", [made.users]);
  await pool.query("DELETE FROM courses WHERE course_id = ANY($1)", [made.courses]);
  await pool.end();
});

describe("user provisioning", () => {
  test("create a student: temporary password that passes the rules, must change it at first sign-in", async () => {
    const res = await request(app)
      .post("/api/admin/users/student")
      .set(as(admin))
      .send({ email: `${TAG.toLowerCase()}.s@smartedu.test`, full_name: `Jest ${TAG}`, roll_no: `${TAG}-S`, department_id: 1, gender: "Female", age: 21 });
    expect(res.status).toBe(201);
    expect(passwordProblems(res.body.tempPassword)).toEqual([]);
    const { rows } = await pool.query("SELECT u.user_id, u.must_reset_pw, u.role FROM users u WHERE email = $1", [`${TAG.toLowerCase()}.s@smartedu.test`]);
    made.users.push(rows[0].user_id);
    expect(rows[0]).toMatchObject({ must_reset_pw: true, role: "student" });
    const signIn = await request(app).post("/api/auth/login").send({ email: `${TAG.toLowerCase()}.s@smartedu.test`, password: res.body.tempPassword, portal: "student" });
    expect(signIn.body.mustResetPassword).toBe(true);
  });

  test("create a faculty member; duplicates are 409, missing fields 400, bad department 400", async () => {
    const body = { email: `${TAG.toLowerCase()}.f@smartedu.test`, full_name: `Jest ${TAG}`, employee_no: `${TAG}-F`, department_id: 1, designation: "Lecturer" };
    const res = await request(app).post("/api/admin/users/faculty").set(as(admin)).send(body);
    expect(res.status).toBe(201);
    made.users.push((await pool.query("SELECT user_id FROM users WHERE email = $1", [body.email])).rows[0].user_id);
    expect((await request(app).post("/api/admin/users/faculty").set(as(admin)).send(body)).status).toBe(409);
    expect((await request(app).post("/api/admin/users/faculty").set(as(admin)).send({ email: "x@y.z" })).status).toBe(400);
    expect((await request(app).post("/api/admin/users/student").set(as(admin)).send({ email: `${TAG}.bad@smartedu.test`, full_name: "x", roll_no: `${TAG}-B`, department_id: 999 })).status).toBe(400);
  });
});

describe("courses, classes and enrollments", () => {
  let courseId, classId, enrollmentId;
  test("create a course (duplicate code 409), assign a teacher (duplicate 409), enroll a student, drop, unassign", async () => {
    const c = await request(app).post("/api/admin/courses").set(as(admin)).send({ course_code: TAG, title: "Jest course", department_id: 1, credit_hours: 3 });
    expect(c.status).toBe(201);
    courseId = c.body.course_id;
    made.courses.push(courseId);
    expect((await request(app).post("/api/admin/courses").set(as(admin)).send({ course_code: TAG, title: "again", department_id: 1 })).status).toBe(409);
    expect((await request(app).post("/api/admin/courses").set(as(admin)).send({ title: "no code" })).status).toBe(400);

    const { rows: [fac] } = await pool.query("SELECT f.faculty_id FROM faculty f JOIN users u USING (user_id) WHERE u.email = 'amina.sheikh@smartedu.edu'");
    const fcBody = { faculty_id: fac.faculty_id, course_id: courseId, section: "J", semester: 5, academic_year: "2025-2026" };
    const fc = await request(app).post("/api/admin/faculty-courses").set(as(admin)).send(fcBody);
    expect(fc.status).toBe(201);
    classId = fc.body.faculty_course_id;
    expect((await request(app).post("/api/admin/faculty-courses").set(as(admin)).send(fcBody)).status).toBe(409);

    const sid = await studentId("BU-100040");
    const en = await request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: sid, faculty_course_id: classId });
    expect(en.status).toBe(201);
    enrollmentId = en.body.enrollment_id;
    expect((await request(app).post("/api/admin/enrollments").set(as(admin)).send({ student_id: sid, faculty_course_id: classId })).status).toBe(409);

    const list = await request(app).get("/api/admin/enrollments").set(as(admin));
    expect(list.status).toBe(200);
    const rec = await request(app).get(`/api/admin/class-records/${classId}`).set(as(admin));
    expect(rec.status).toBe(200);

    const drop = await request(app).put(`/api/admin/enrollments/${enrollmentId}/drop`).set(as(admin));
    expect(drop.status).toBe(200);
    expect((await pool.query("SELECT status FROM enrollments WHERE enrollment_id = $1", [enrollmentId])).rows[0].status).toBe("dropped");
    expect((await request(app).put("/api/admin/enrollments/99999999/drop").set(as(admin))).status).toBe(404);

    const un = await request(app).delete(`/api/admin/faculty-courses/${classId}`).set(as(admin));
    expect([200, 204]).toContain(un.status);
  });
});

describe("directory and drill-down", () => {
  test("students: search and paging (limit capped at 100)", async () => {
    const s = await request(app).get("/api/admin/students?search=BU-144766").set(as(admin));
    expect(s.body.rows.map((r) => r.roll_no)).toEqual(["BU-144766"]);
    const big = await request(app).get("/api/admin/students?limit=500").set(as(admin));
    expect(big.body.rows.length).toBe(100);
    expect(big.body.limit).toBe(100);
    expect(big.body.total).toBeGreaterThanOrEqual(50000);
  });

  test("student full view: history, predictions with staff wording, never the dataset label; 400 / 404", async () => {
    const id = await studentId("BU-144766");
    const res = await request(app).get(`/api/admin/students/${id}/full`).set(as(admin));
    expect(res.status).toBe(200);
    expect(allKeys(res.body).has("target_label")).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/"Your /);
    expect((await request(app).get("/api/admin/students/abc/full").set(as(admin))).status).toBe(400);
    expect((await request(app).get("/api/admin/students/99999999/full").set(as(admin))).status).toBe(404);
  });

  test("faculty list, courses and classes", async () => {
    const f = await request(app).get("/api/admin/faculty").set(as(admin));
    expect(f.body.length).toBeGreaterThanOrEqual(10);
    expect((await request(app).get("/api/admin/courses").set(as(admin))).body.length).toBeGreaterThanOrEqual(20);
    expect((await request(app).get("/api/admin/faculty-courses").set(as(admin))).body.length).toBeGreaterThanOrEqual(25);
  });
});

describe("flagged students and predictions", () => {
  const get = (q) => request(app).get(`/api/admin/at-risk-students?${q}`).set(as(admin));

  test("only flagged labels; the label filter narrows to one label", async () => {
    const all = await get("limit=100");
    expect(all.body.rows.every((r) => ["At-Risk", "Dropout-Likely"].includes(r.final_label))).toBe(true);
    const ar = await get("label=At-Risk&limit=50");
    expect(ar.body.rows.every((r) => r.final_label === "At-Risk")).toBe(true);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id WHERE p.final_label = 'At-Risk'"
    );
    expect(ar.body.total).toBe(rows[0].n);
  });

  test("department filter, search, sort by roll and paging", async () => {
    const dep = await get("department=4&limit=50");
    expect(dep.body.rows.every((r) => r.department === "Artificial Intelligence" || r.department_code === "AI" || r.department_id === 4)).toBe(true);
    const one = await get("search=BU-144766");
    expect(one.body.rows).toHaveLength(1);
    expect(one.body.rows[0]).toEqual(expect.objectContaining({ weakest_course: expect.any(Object), tutorial: expect.any(Object) }));
    const byRoll = await get("sort=roll&limit=20");
    const rolls = byRoll.body.rows.map((r) => r.roll_no);
    expect(rolls).toEqual([...rolls].sort());
    const p1 = await get("sort=roll&limit=20&page=1");
    const p2 = await get("sort=roll&limit=20&page=2");
    expect(p2.body.rows[0].roll_no > p1.body.rows[19].roll_no).toBe(true);
    expect(p1.body.totalPages).toBe(Math.ceil(p1.body.total / 20));
  });

  test("predictions list covers every label, paged", async () => {
    const res = await request(app).get("/api/admin/predictions?limit=10").set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(10);
    expect(res.body.total).toBe((await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE latest_prediction_id IS NOT NULL")).rows[0].n);
  });

  test("dashboard KPIs agree with the database", async () => {
    const res = await request(app).get("/api/admin/dashboard").set(as(admin));
    const { rows: [db] } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM students)::int AS students, (SELECT COUNT(*) FROM faculty)::int AS faculty,
              (SELECT COUNT(*) FROM courses)::int AS courses`
    );
    expect(res.body.kpis).toMatchObject({ students: db.students, faculty: db.faculty, courses: db.courses });
    const counts = res.body.riskCounts;
    const sum = Array.isArray(counts) ? counts.reduce((n, c) => n + Number(c.count || c.n || 0), 0) : Object.values(counts).reduce((n, v) => n + Number(v), 0);
    expect(sum).toBe(Number(res.body.kpis.predicted));
  });
});

describe("batch prediction runs (ML mocked)", () => {
  let snap, warn, classIds;
  const realFetch = global.fetch;
  beforeAll(async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT e.student_id FROM enrollments e WHERE e.faculty_course_id = 16 AND e.status = 'enrolled'`
    );
    classIds = rows.map((r) => r.student_id);
    snap = await takeSnapshot({ studentIds: classIds });
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const r = { label: "Safe", prob_safe: 0.9, prob_at_risk: 0.05, prob_dropout: 0.05, model_version: "mocked_v1", explanations: [], base_value: 0.3 };
      return { ok: true, json: async () => (String(url).endsWith("/batch") ? { results: body.rows.map(() => r) } : r) };
    });
  });
  afterAll(async () => {
    global.fetch = realFetch;
    warn.mockRestore();
    await restoreSnapshot(snap);
    await pool.query("DELETE FROM prediction_runs WHERE started_at >= $1", [snap.at]);
  });

  test("a class run: 202, completes, one admin_run prediction per student; listed with its scope", async () => {
    const res = await request(app).post("/api/admin/predictions/run").set(as(admin)).send({ scope: "class", scopeId: 16 });
    expect(res.status).toBe(202);
    const id = res.body.id;
    let run;
    for (let i = 0; i < 50; i++) {
      run = (await request(app).get(`/api/admin/predictions/runs/${id}`).set(as(admin))).body;
      if (run.status !== "running" && run.status !== "queued") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(run).toMatchObject({ status: "completed", total: classIds.length, done: classIds.length, failed: 0 });
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM predictions WHERE run_id = $1 AND triggered_by = 'admin_run'", [id]);
    expect(rows[0].n).toBe(classIds.length);
    const list = await request(app).get("/api/admin/predictions/runs?limit=5").set(as(admin));
    expect(list.body.find((r) => r.id === id)).toBeTruthy();
  });

  test("only one run at a time (409); unknown scope 400; unknown department 404; unknown run 404", async () => {
    const { rows: [fake] } = await pool.query("INSERT INTO prediction_runs (scope, total, status, started_by) VALUES ('all', 1, 'running', $1) RETURNING id", [adminId]);
    try {
      expect((await request(app).post("/api/admin/predictions/run").set(as(admin)).send({ scope: "all" })).status).toBe(409);
    } finally {
      await pool.query("DELETE FROM prediction_runs WHERE id = $1", [fake.id]);
    }
    expect((await request(app).post("/api/admin/predictions/run").set(as(admin)).send({ scope: "galaxy" })).status).toBe(400);
    expect((await request(app).post("/api/admin/predictions/run").set(as(admin)).send({ scope: "department", scopeId: 999 })).status).toBe(404);
    expect((await request(app).get("/api/admin/predictions/runs/99999999").set(as(admin))).status).toBe(404);
  });
});
