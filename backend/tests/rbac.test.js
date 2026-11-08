const request = require("supertest");
const app = require("../src/app");
const { login, pool } = require("./helpers");

// Role-based access control on EVERY route of every route group: no token -> 401, another role ->
// 403 (checked by the router before any handler or input validation runs, so nothing is written),
// and the role's own read routes answer 2xx. Write routes are only probed with the wrong roles here;
// their behaviour for the right role is covered by the feature suites.

const as = (t) => ({ Authorization: `Bearer ${t}` });
let tokens;
let ids;

beforeAll(async () => {
  const [student, faculty, admin] = await Promise.all([
    login(app, "student100040@smartedu.edu", "student"),
    login(app, "ayesha.khan@smartedu.edu", "faculty"),
    login(app, "admin@smartedu.edu", "admin"),
  ]);
  tokens = { student, faculty, admin };
  const { rows: [r] } = await pool.query(
    `SELECT s.student_id, e.enrollment_id, e.faculty_course_id AS class_id
     FROM students s JOIN enrollments e USING (student_id) JOIN faculty_courses fc USING (faculty_course_id)
     JOIN faculty f USING (faculty_id) JOIN users u ON u.user_id = f.user_id
     WHERE s.roll_no = 'BU-100040' AND u.email = 'ayesha.khan@smartedu.edu' LIMIT 1`
  );
  ids = r;
});

afterAll(() => pool.end());

// [method, path, kind]: kind "read" routes must also succeed for the owning role
const ROUTES = {
  student: [
    ["get", "/api/student/dashboard", "read"],
    ["get", "/api/student/results", "read"],
    ["get", "/api/student/attendance", "read"],
    ["get", "/api/student/history", "read"],
    ["get", "/api/student/prediction", "read"],
    ["get", "/api/student/prediction/timeline", "read"],
    ["get", "/api/student/next-steps", "read"],
    ["get", "/api/student/chat/history", "read"],
    ["post", "/api/student/prediction/refresh", "write"],
    ["post", "/api/student/chat", "write"],
    ["delete", "/api/student/chat/history", "write"],
  ],
  faculty: [
    ["get", "/api/faculty/classes", "read"],
    ["get", () => `/api/faculty/classes/${ids.class_id}/roster`, "read"],
    ["get", () => `/api/faculty/classes/${ids.class_id}/attendance`, "read"],
    ["get", () => `/api/faculty/classes/${ids.class_id}/risk-summary`, "read"],
    ["get", () => `/api/faculty/classes/${ids.class_id}/templates/results.csv`, "read"],
    ["get", "/api/faculty/uploads", "read"],
    ["get", "/api/faculty/summary", "read"],
    ["get", "/api/faculty/counselees", "read"],
    ["get", "/api/faculty/counselees/1", "write"], // 403 for someone else's assignment, so not "read"
    ["put", () => `/api/faculty/results/${ids.enrollment_id}`, "write"],
    ["post", "/api/faculty/attendance", "write"],
    ["post", () => `/api/faculty/classes/${ids.class_id}/upload?kind=results&mode=preview`, "write"],
    ["put", "/api/faculty/counselees/1", "write"],
    ["post", () => `/api/faculty/students/${ids.student_id}/what-if`, "write"],
  ],
  admin: [
    ["get", "/api/admin/dashboard", "read"],
    ["get", "/api/admin/departments", "read"],
    ["get", "/api/admin/audit-log", "read"],
    ["get", "/api/admin/students", "read"],
    ["get", "/api/admin/faculty", "read"],
    ["get", () => `/api/admin/students/${ids.student_id}/full`, "read"],
    ["get", "/api/admin/courses", "read"],
    ["get", "/api/admin/faculty-courses", "read"],
    ["get", "/api/admin/enrollments", "read"],
    ["get", () => `/api/admin/class-records/${ids.class_id}`, "read"],
    ["get", "/api/admin/at-risk-students", "read"],
    ["get", "/api/admin/at-risk-students/export", "read"],
    ["get", "/api/admin/predictions", "read"],
    ["get", "/api/admin/predictions/runs", "read"],
    ["get", "/api/admin/tutorials", "read"],
    ["get", "/api/admin/counselors", "read"],
    ["get", "/api/admin/faculty/workload", "read"],
    ["get", "/api/admin/model", "read"],
    ["get", "/api/admin/live-cohort/template.csv", "read"],
    ["get", "/api/admin/predictions/runs/1", "write"], // 404 once runs are gone; access is what's tested
    ["post", "/api/admin/users/student", "write"],
    ["post", "/api/admin/users/faculty", "write"],
    ["put", "/api/admin/users/1/deactivate", "write"],
    ["put", "/api/admin/users/1/reactivate", "write"],
    ["put", "/api/admin/users/1/reset-password", "write"],
    ["post", "/api/admin/courses", "write"],
    ["post", "/api/admin/faculty-courses", "write"],
    ["delete", "/api/admin/faculty-courses/1", "write"],
    ["post", "/api/admin/enrollments", "write"],
    ["put", "/api/admin/enrollments/1/drop", "write"],
    ["post", "/api/admin/notifications", "write"],
    ["post", "/api/admin/notifications/bulk", "write"],
    ["post", "/api/admin/notifications/preview", "write"],
    ["post", "/api/admin/tutorials", "write"],
    ["put", "/api/admin/tutorials/1", "write"],
    ["put", "/api/admin/tutorials/1/deactivate", "write"],
    ["post", "/api/admin/counselors", "write"],
    ["put", "/api/admin/counselors/1/close", "write"],
    ["post", "/api/admin/live-cohort?mode=preview", "write"],
    ["post", "/api/admin/predictions/run", "write"],
    ["post", () => `/api/admin/students/${ids.student_id}/what-if`, "write"],
  ],
};

const path = (p) => (typeof p === "function" ? p() : p);
const call = (method, p, token) => {
  const r = request(app)[method](path(p));
  return token ? r.set(as(token)) : r;
};

describe.each(Object.keys(ROUTES))("%s routes", (owner) => {
  const others = Object.keys(ROUTES).filter((r) => r !== owner);

  test.each(ROUTES[owner].map(([m, p]) => [m.toUpperCase(), p]))("%s %p: no token -> 401", async (m, p) => {
    expect((await call(m.toLowerCase(), p)).status).toBe(401);
  });

  test.each(ROUTES[owner].flatMap(([m, p]) => others.map((o) => [m.toUpperCase(), p, o])))(
    "%s %p: %s token -> 403",
    async (m, p, other) => {
      const res = await call(m.toLowerCase(), p, tokens[other]);
      expect(res.status).toBe(403);
    }
  );

  const reads = ROUTES[owner].filter(([, , kind]) => kind === "read");
  test.each(reads.map(([m, p]) => [m.toUpperCase(), p]))(`%s %p: ${owner} token -> 2xx`, async (m, p) => {
    const res = await call(m.toLowerCase(), p, tokens[owner]);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    // includes GET /admin/at-risk-students/export, which streams all ~26,700 flagged students (5-6 s on the demo
    // machine, more under coverage), so Jest's 5 s default is too tight for it
  }, 30000);
});

describe("notifications (any signed-in role, own rows only)", () => {
  test("no token -> 401 on every route", async () => {
    expect((await request(app).get("/api/notifications/mine")).status).toBe(401);
    expect((await request(app).put("/api/notifications/1/read")).status).toBe(401);
    expect((await request(app).put("/api/notifications/read-all")).status).toBe(401);
  });

  test.each(["student", "faculty", "admin"])("%s can read their own list", async (role) => {
    const res = await request(app).get("/api/notifications/mine").set(as(tokens[role]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ notifications: expect.any(Array), unreadCount: expect.any(Number) }));
  });

  test("marking someone else's notification read changes nothing", async () => {
    const { rows: [n] } = await pool.query(
      `INSERT INTO notifications (sender_admin_id, recipient_user_id, subject, message)
       SELECT (SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'), user_id, 'jest rbac', 'jest rbac'
       FROM users WHERE email = 'ayesha.khan@smartedu.edu' RETURNING notification_id`
    );
    try {
      const res = await request(app).put(`/api/notifications/${n.notification_id}/read`).set(as(tokens.student));
      expect([403, 404]).toContain(res.status);
      const { rows } = await pool.query("SELECT read_at FROM notifications WHERE notification_id = $1", [n.notification_id]);
      expect(rows[0].read_at).toBeNull();
      // the owner can
      const own = await request(app).put(`/api/notifications/${n.notification_id}/read`).set(as(tokens.faculty));
      expect(own.status).toBe(200);
    } finally {
      await pool.query("DELETE FROM notifications WHERE notification_id = $1", [n.notification_id]);
    }
  });
});
