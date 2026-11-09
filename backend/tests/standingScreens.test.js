const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

// Phase 7, step 6: the data behind the probation screens - admin list, KPIs, standing filters
// (directory, at-risk list, CSV), faculty roster / counselees, the student card. Read-only.
const as = (t) => ({ Authorization: `Bearer ${t}` });
let admin, ayesha, student;

beforeAll(async () => {
  [admin, ayesha, student] = await Promise.all([
    login(app, "admin@smartedu.edu", "admin"),
    login(app, "ayesha.khan@smartedu.edu", "faculty"),
    login(app, "student144766@smartedu.edu", "student"),
  ]);
});
afterAll(() => pool.end());

const count = async (status) => (await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE academic_status = $1", [status])).rows[0].n;

test("dashboard KPIs: Probation 1, Probation 2, Dropped (separate from the risk counts)", async () => {
  const res = await request(app).get("/api/admin/dashboard").set(as(admin));
  expect(res.status).toBe(200);
  expect(res.body.kpis).toMatchObject({ probation_1: await count("probation_1"), probation_2: await count("probation_2"), dropped: await count("dropped") });
  expect(res.body.standingCounts.good).toBe(await count("good"));
});

test("probation list: on probation by default, filters, every row's standing and hold", async () => {
  const res = await request(app).get("/api/admin/academic-standing?limit=50").set(as(admin));
  expect(res.status).toBe(200);
  expect(res.body.total).toBe((await count("probation_1")) + (await count("probation_2")));
  for (const r of res.body.rows) {
    expect(["probation_1", "probation_2"]).toContain(r.academic_status);
    expect(r.hold).toBe(r.academic_status === "probation_2" ? (r.approver_role ? "approved" : "on_hold") : null);
  }
  const p2 = await request(app).get("/api/admin/academic-standing?status=probation_2&search=BU-144766").set(as(admin));
  expect(p2.body.rows.map((r) => r.roll_no)).toEqual(["BU-144766"]);
  expect(p2.body.rows[0]).toMatchObject({ label: "Probation 2 of 2", final_label: expect.any(String) });
  expect((await request(app).get("/api/admin/academic-standing?status=maybe").set(as(admin))).status).toBe(400);
});

test("directory and at-risk list filter by standing and carry it; the CSV has the column", async () => {
  const dir = await request(app).get("/api/admin/students?standing=probation_1&limit=5").set(as(admin));
  expect(dir.body.total).toBe(await count("probation_1"));
  expect(dir.body.rows.every((r) => r.academic_status === "probation_1")).toBe(true);
  const risk = await request(app).get("/api/admin/at-risk-students?standing=probation_2&limit=10").set(as(admin));
  expect(risk.status).toBe(200);
  expect(risk.body.rows.length).toBeGreaterThan(0);
  expect(risk.body.rows.every((r) => r.academic_status === "probation_2")).toBe(true);
  const csv = await request(app).get("/api/admin/at-risk-students/export?standing=probation_1&search=BU-122785").set(as(admin));
  const lines = csv.text.replace(/^﻿/, "").trim().split(/\r?\n/);
  expect(lines[0].split(",")[4]).toBe("academic_standing");
  expect(lines[1]).toContain("Probation 1 of 2");
});

test("faculty: roster and counselees carry the standing; probation first in My counselees", async () => {
  const { rows: [cls] } = await pool.query(
    `SELECT fc.faculty_course_id FROM faculty_courses fc JOIN faculty f USING (faculty_id) JOIN users u ON u.user_id = f.user_id
     WHERE u.email = 'ayesha.khan@smartedu.edu' ORDER BY 1 LIMIT 1`
  );
  const roster = await request(app).get(`/api/faculty/classes/${cls.faculty_course_id}/roster`).set(as(ayesha));
  expect(roster.status).toBe(200);
  expect(roster.body.every((r) => typeof r.academic_status === "string")).toBe(true);
  const counselees = await request(app).get("/api/faculty/counselees").set(as(ayesha));
  const rank = (s) => (s === "probation_2" ? 0 : s === "probation_1" ? 1 : 2);
  const ranks = counselees.body.map((c) => rank(c.academic_status));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test("student: own standing card data (Probation 2 hold, this term's target), never anyone else's", async () => {
  const res = await request(app).get("/api/student/standing").set(as(student));
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "probation_2", label: "Probation 2 of 2", minimum: 2, hold: { active: true } });
  expect(res.body.this_term).toEqual(expect.objectContaining({ uses: "CGPA", needed_mark: expect.any(Number), needed_grade: expect.any(String) }));
  expect(res.body).not.toHaveProperty("approvals");
  // the route takes no id: there is no way to ask for another student's standing
  expect((await request(app).get("/api/student/standing?studentId=1").set(as(student))).body.status).toBe("probation_2");
});
