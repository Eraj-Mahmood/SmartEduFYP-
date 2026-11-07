const request = require("supertest");
const app = require("../src/app");
const { createTempUser, dropTempUser, pool } = require("./helpers");

// Separate login portals: POST /api/auth/login requires portal (student | faculty | admin).
// Wrong credentials: one generic 401 on every portal. Right password, other role: 403 WRONG_PORTAL
// with correctPortal and no token (audit-logged). Missing / invalid portal: 400.

const ACCOUNTS = {
  student: { email: "student100040@smartedu.edu", password: "Student@123" },
  faculty: { email: "ayesha.khan@smartedu.edu", password: "Faculty@123" },
  admin: { email: "admin@smartedu.edu", password: "Admin@123" },
};
const PORTALS = Object.keys(ACCOUNTS);
const NAMES = { student: "Student", faculty: "Faculty", admin: "Admin" };

const signIn = (body) => request(app).post("/api/auth/login").send(body);
const since = new Date();
const temps = [];

afterAll(async () => {
  for (const u of temps) await dropTempUser(u.userId);
  await pool.query("DELETE FROM audit_log WHERE action = 'LOGIN_WRONG_PORTAL' AND created_at >= $1", [since]);
  await pool.end();
});

describe("each role signs in through its own portal", () => {
  test.each(PORTALS)("%s portal", async (role) => {
    const res = await signIn({ ...ACCOUNTS[role], portal: role });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe(role);
    expect(res.body.token).toEqual(expect.any(String));
  });
});

describe("the right password on another role's portal", () => {
  const cases = PORTALS.flatMap((role) => PORTALS.filter((p) => p !== role).map((portal) => [role, portal]));
  test.each(cases)("a %s account on the %s portal gets WRONG_PORTAL and no token", async (role, portal) => {
    const res = await signIn({ ...ACCOUNTS[role], portal });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: "WRONG_PORTAL",
      correctPortal: role,
      error: `This is a ${role} account - please use the ${NAMES[role]} sign in`,
    });
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no JWT anywhere in the body
  });

  test("is audit-logged with the portal tried and the right one", async () => {
    const t0 = new Date();
    await signIn({ ...ACCOUNTS.student, portal: "admin" });
    const { rows } = await pool.query(
      `SELECT a.details FROM audit_log a JOIN users u ON u.user_id = a.actor_user_id
       WHERE a.action = 'LOGIN_WRONG_PORTAL' AND u.email = $1 AND a.created_at >= $2`,
      [ACCOUNTS.student.email, t0]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({ portal: "admin", correctPortal: "student" });
  });
});

describe("wrong credentials look the same on every portal", () => {
  test("wrong password and unknown email: identical 401 for every account on every portal", async () => {
    const responses = [];
    for (const portal of PORTALS) {
      for (const role of PORTALS) {
        responses.push(await signIn({ email: ACCOUNTS[role].email, password: "Wrong-pass1", portal }));
      }
      responses.push(await signIn({ email: "nobody.here@smartedu.edu", password: "Wrong-pass1", portal }));
    }
    for (const r of responses) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: "Invalid email or password" });
    }
  });

  test("a deactivated account with a wrong password gets the generic 401 (not 'deactivated')", async () => {
    const u = await createTempUser("student");
    temps.push(u);
    await pool.query("UPDATE users SET is_active = FALSE WHERE user_id = $1", [u.userId]);
    const wrong = await signIn({ email: u.email, password: "Wrong-pass1", portal: "student" });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: "Invalid email or password" });
    const right = await signIn({ email: u.email, password: u.password, portal: "student" });
    expect(right.status).toBe(403);
    expect(right.body.token).toBeUndefined();
  });
});

describe("portal is required", () => {
  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "parent"],
    ["wrong case", "Student"],
  ])("%s portal gets 400", async (_label, portal) => {
    const res = await signIn({ ...ACCOUNTS.student, ...(portal === undefined ? {} : { portal }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/portal/);
    expect(res.body.token).toBeUndefined();
  });
});
