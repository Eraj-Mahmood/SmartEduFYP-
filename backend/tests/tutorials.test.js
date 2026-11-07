const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

// Tutorials (FR11): seeded per course by src/scripts/seedTutorials.js, managed by admins.

let admin;
const created = [];

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
});

afterAll(async () => {
  if (created.length) {
    await pool.query("DELETE FROM audit_log WHERE entity = 'tutorials' AND entity_id = ANY($1)", [created]);
    await pool.query("DELETE FROM tutorials WHERE tutorial_id = ANY($1)", [created]);
  }
  await pool.end();
});

const as = (t) => ({ Authorization: `Bearer ${t}` });

test("every course has at least one active tutorial", async () => {
  const { rows } = await pool.query(
    `SELECT c.course_code FROM courses c
     WHERE NOT EXISTS (SELECT 1 FROM tutorials t WHERE t.course_id = c.course_id AND t.is_active)`
  );
  expect(rows).toEqual([]);
});

test("the tutorial API is admin-only", async () => {
  const fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
  expect((await request(app).get("/api/admin/tutorials").set(as(fac))).status).toBe(403);
});

test("admin can add, edit and deactivate a tutorial; duplicates and bad input are refused", async () => {
  const { rows } = await pool.query("SELECT course_id FROM courses WHERE course_code = 'AI402'");
  const body = { course_id: rows[0].course_id, title: "Jest tutorial", url: `https://example.com/jest-${Date.now()}`, kind: "notes" };
  const add = await request(app).post("/api/admin/tutorials").set(as(admin)).send(body);
  expect(add.status).toBe(201);
  created.push(add.body.tutorial_id);
  expect(add.body).toMatchObject({ course_code: "AI402", is_active: true });

  expect((await request(app).post("/api/admin/tutorials").set(as(admin)).send(body)).status).toBe(409);
  expect((await request(app).post("/api/admin/tutorials").set(as(admin)).send({ ...body, url: "ftp://x", kind: "pdf" })).status).toBe(400);

  const edit = await request(app).put(`/api/admin/tutorials/${add.body.tutorial_id}`).set(as(admin)).send({ title: "Renamed" });
  expect(edit.body.title).toBe("Renamed");
  const off = await request(app).put(`/api/admin/tutorials/${add.body.tutorial_id}/deactivate`).set(as(admin));
  expect(off.body.is_active).toBe(false);

  const log = await pool.query("SELECT action FROM audit_log WHERE entity = 'tutorials' AND entity_id = $1 ORDER BY log_id", [add.body.tutorial_id]);
  expect(log.rows.map((r) => r.action)).toEqual(["CREATE_TUTORIAL", "UPDATE_TUTORIAL", "DEACTIVATE_TUTORIAL"]);
});
