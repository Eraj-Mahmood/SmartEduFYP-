const request = require("supertest");
const app = require("../src/app");
const { fillTemplate } = require("../src/services/interventions");
const { recommendFor } = require("../src/services/tutorials");
const { login, studentId, pool } = require("./helpers");

// Interventions with placeholders and the recommended tutorial. The notifications created here
// are deleted afterwards so the demo students' bells stay as they were.
const DEMO = ["BU-122785", "BU-112907", "BU-144766"]; // At-Risk, At-Risk, Dropout-Likely
const SUBJECT = "Jest check-in for {name}";
const since = new Date();
let admin;
const as = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
});

afterAll(async () => {
  await pool.query("DELETE FROM notifications WHERE sent_at >= $1 AND subject LIKE 'Jest %'", [since]);
  await pool.query("DELETE FROM audit_log WHERE created_at >= $1 AND action IN ('BULK_NOTIFY', 'SEND_NOTIFICATION') AND details->>'subject' LIKE 'Jest %'", [since]);
  await pool.query("DELETE FROM audit_log WHERE created_at >= $1 AND action = 'SEND_NOTIFICATION' AND actor_user_id = 1 AND entity_id NOT IN (SELECT notification_id FROM notifications)", [since]);
  await pool.end();
});

test("fillTemplate fills known placeholders and reports unknown ones", () => {
  const out = fillTemplate("Hi {name}, see {Course} with {counselor}. {when} {name}", { name: "A", course: "X101", counselor: "Dr. B" });
  expect(out.text).toBe("Hi A, see X101 with Dr. B. {when} A");
  expect(out.unknown).toEqual(["{when}"]);
});

test("a bulk send to 3 demo students gives each their own name and tutorial", async () => {
  const ids = await Promise.all(DEMO.map(studentId));
  const res = await request(app)
    .post("/api/admin/notifications/bulk")
    .set(as(admin))
    .send({ studentIds: ids, subject: SUBJECT, message: "Dear {name}, please spend extra time on {course}. Reply by {deadline}." });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ sent: 3, matched: 3, capped: false, unknownPlaceholders: ["{deadline}"] });

  for (const [i, roll] of DEMO.entries()) {
    const { rows } = await pool.query(
      `SELECT s.full_name, n.subject, n.message, n.related_tutorial_id, n.kind, n.link
       FROM notifications n JOIN students s ON s.user_id = n.recipient_user_id
       WHERE s.roll_no = $1 AND n.sent_at >= $2 AND n.subject LIKE 'Jest %'`,
      [roll, since]
    );
    expect(rows).toHaveLength(1);
    const n = rows[0];
    const rec = await recommendFor(ids[i]);
    expect(n.subject).toBe(`Jest check-in for ${n.full_name}`);
    expect(n.message).toContain(`Dear ${n.full_name}, please spend extra time on ${rec.course.course_code} (${rec.course.title}).`);
    expect(n.message).toContain("{deadline}");
    expect(n.message).toContain(`"${rec.tutorial.title}" - ${rec.tutorial.url}`);
    expect(n.related_tutorial_id).toBe(rec.tutorial.tutorial_id);
    expect(n).toMatchObject({ kind: "intervention", link: "/student#what-next" });
    // nobody else's name
    for (const other of DEMO.filter((r) => r !== roll)) {
      const o = await pool.query("SELECT full_name FROM students WHERE roll_no = $1", [other]);
      expect(n.message).not.toContain(o.rows[0].full_name);
    }
  }

  const log = await pool.query("SELECT details FROM audit_log WHERE action = 'BULK_NOTIFY' AND created_at >= $1 ORDER BY log_id DESC LIMIT 1", [since]);
  expect(log.rows[0].details).toMatchObject({ sent: 3, subject: SUBJECT });
});

test("includeTutorial: false leaves the tutorial out", async () => {
  const [uid] = (await pool.query("SELECT user_id FROM students WHERE roll_no = 'BU-144766'")).rows.map((r) => r.user_id);
  const res = await request(app)
    .post("/api/admin/notifications")
    .set(as(admin))
    .send({ recipient_user_id: uid, subject: "Jest single", message: "Hello {name}", includeTutorial: false });
  expect(res.status).toBe(201);
  expect(res.body.related_tutorial_id).toBeNull();
  expect(res.body.message).toMatch(/^Hello \S+ \S+$/);
});

test("more than 500 studentIds is refused; a filter is capped at 500", async () => {
  const many = Array.from({ length: 501 }, (_, i) => i + 1);
  const big = await request(app).post("/api/admin/notifications/bulk").set(as(admin)).send({ studentIds: many, subject: "Jest x", message: "x" });
  expect(big.status).toBe(400);
  const both = await request(app).post("/api/admin/notifications/bulk").set(as(admin)).send({ studentIds: [1], filter: {}, subject: "Jest x", message: "x" });
  expect(both.status).toBe(400);
});

test("a filter send reaches only the matching flagged students", async () => {
  const res = await request(app)
    .post("/api/admin/notifications/bulk")
    .set(as(admin))
    .send({ filter: { search: "BU-144766" }, subject: "Jest filter", message: "Hi {name}" });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ sent: 1, matched: 1, capped: false });
});

test("preview fills one message without sending it", async () => {
  const id = await studentId("BU-144766");
  const before = await pool.query("SELECT COUNT(*)::int AS n FROM notifications");
  const res = await request(app).post("/api/admin/notifications/preview").set(as(admin)).send({ studentId: id, subject: "Jest {name}", message: "Counselor: {counselor}" });
  expect(res.status).toBe(200);
  expect(res.body.subject).toBe(`Jest ${res.body.full_name}`);
  expect(res.body.message).toMatch(/^Counselor: /);
  const after = await pool.query("SELECT COUNT(*)::int AS n FROM notifications");
  expect(after.rows[0].n).toBe(before.rows[0].n);
});

test("the bulk endpoint is admin-only", async () => {
  const fac = await login(app, "ayesha.khan@smartedu.edu", "faculty");
  const res = await request(app).post("/api/admin/notifications/bulk").set(as(fac)).send({ studentIds: [1], subject: "Jest x", message: "x" });
  expect(res.status).toBe(403);
});
