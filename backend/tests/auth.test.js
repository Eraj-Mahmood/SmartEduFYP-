const request = require("supertest");
const app = require("../src/app");
const { login, createTempUser, dropTempUser, pool } = require("./helpers");

// Account safety: a deactivated user's existing token stops working at once.

let admin;
const temps = [];

beforeAll(async () => {
  admin = await login(app, "admin@smartedu.edu", "admin");
});

afterAll(async () => {
  for (const u of temps) await dropTempUser(u.userId);
  await pool.end();
});

const signIn = (u) => request(app).post("/api/auth/login").send({ email: u.email, password: u.password });

describe("deactivated users", () => {
  test("an existing token is rejected with 401 ACCOUNT_DISABLED after deactivation", async () => {
    const u = await createTempUser("student");
    temps.push(u);
    const { body } = await signIn(u);
    const me = () => request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`);
    expect((await me()).status).toBe(200);

    const off = await request(app).put(`/api/admin/users/${u.userId}/deactivate`).set("Authorization", `Bearer ${admin}`);
    expect(off.status).toBe(200);

    const res = await me();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_DISABLED");
    // and a fresh login is refused too
    expect((await signIn(u)).status).toBe(403);
  });

  test("a token for a user that no longer exists is rejected", async () => {
    const u = await createTempUser("student");
    const { body } = await signIn(u);
    await dropTempUser(u.userId);
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_DISABLED");
  });
});

describe("demo accounts", () => {
  test("no imported, seeded or createAdmin account must reset its password", async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE must_reset_pw
         AND (email ~ '^student[0-9]+@smartedu[.]edu$' OR email = 'admin@smartedu.edu'
              OR user_id IN (SELECT user_id FROM faculty WHERE employee_no ~ '^F-10(0[1-9]|10)$'))`
    );
    expect(rows[0].n).toBe(0);
  });
});
