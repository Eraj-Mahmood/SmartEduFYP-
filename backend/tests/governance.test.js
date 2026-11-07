const request = require("supertest");
const app = require("../src/app");
const { csvField } = require("../src/controllers/governanceController");
const { login, createTempUser, dropTempUser, pool } = require("./helpers");

// Admin governance: reactivation, the audit-log viewer and the flagged-students CSV.

let admin;
const temps = [];
const as = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
});
afterAll(async () => {
  for (const u of temps) {
    await pool.query("DELETE FROM audit_log WHERE entity = 'users' AND entity_id = $1", [u.userId]);
    await dropTempUser(u.userId);
  }
  await pool.end();
});

test("deactivate then reactivate: the token is refused while off and works again after", async () => {
  const u = await createTempUser("student");
  temps.push(u);
  const { body } = await request(app).post("/api/auth/login").send({ email: u.email, password: u.password });
  const me = () => request(app).get("/api/auth/me").set(as(body.token));

  expect((await request(app).put(`/api/admin/users/${u.userId}/deactivate`).set(as(admin))).status).toBe(200);
  expect((await me()).body.code).toBe("ACCOUNT_DISABLED");
  const on = await request(app).put(`/api/admin/users/${u.userId}/reactivate`).set(as(admin));
  expect(on.body.user.is_active).toBe(true);
  expect((await me()).status).toBe(200);

  const log = await pool.query("SELECT action FROM audit_log WHERE entity = 'users' AND entity_id = $1 ORDER BY log_id", [u.userId]);
  expect(log.rows.map((r) => r.action)).toEqual(["DEACTIVATE_USER", "REACTIVATE_USER"]);
});

test("an admin can't deactivate their own account; unknown users are 404", async () => {
  const { rows } = await pool.query("SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'");
  expect((await request(app).put(`/api/admin/users/${rows[0].user_id}/deactivate`).set(as(admin))).status).toBe(400);
  expect((await request(app).put("/api/admin/users/999999999/reactivate").set(as(admin))).status).toBe(404);
});

describe("audit log", () => {
  test("is admin-only", async () => {
    const fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
    const st = await login(app, "student100040@smartedu.edu", "student");
    expect((await request(app).get("/api/admin/audit-log").set(as(fac))).status).toBe(403);
    expect((await request(app).get("/api/admin/audit-log").set(as(st))).status).toBe(403);
    expect((await request(app).get("/api/admin/audit-log")).status).toBe(401);
  });

  test("filters by action, entity, actor and date and pages newest first", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/admin/audit-log?entity=users&actor=admin@smartedu&from=2020-01-01&to=${today}&limit=5`)
      .set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeLessThanOrEqual(5);
    for (const r of res.body.rows) expect(r).toMatchObject({ entity: "users", actor_email: "admin@smartedu.edu" });
    const times = res.body.rows.map((r) => new Date(r.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body.actions).toEqual(expect.arrayContaining(["DEACTIVATE_USER"]));
    expect((await request(app).get("/api/admin/audit-log?from=yesterday").set(as(admin))).status).toBe(400);
  });
});

describe("flagged students CSV", () => {
  test("has the columns and respects the filters", async () => {
    const res = await request(app).get("/api/admin/at-risk-students/export?search=BU-144766").set(as(admin));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="flagged-students-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("roll_no,name,department,label,top_reason,weakest_course,counselor,last_intervention");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^"BU-144766","[^"]+","Artificial Intelligence","Dropout-Likely","[^"]+","AI302 \(avg \d+\)",/);
  });

  test("is admin-only", async () => {
    const fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
    expect((await request(app).get("/api/admin/at-risk-students/export").set(as(fac))).status).toBe(403);
  });

  test("fields are quoted and formula-looking text is neutralised", () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvField(null)).toBe('""');
  });
});
