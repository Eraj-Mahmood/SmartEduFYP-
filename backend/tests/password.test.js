const request = require("supertest");
const app = require("../src/app");
const { passwordProblems } = require("../src/controllers/authController");
const { createTempUser, dropTempUser, pool } = require("./helpers");

// Forced (must_reset_pw) and voluntary password change.

const temps = [];
afterAll(async () => {
  for (const u of temps) await dropTempUser(u.userId);
  await pool.end();
});

const signIn = (u, password = u.password) => request(app).post("/api/auth/login").send({ email: u.email, password });
const as = (t) => ({ Authorization: `Bearer ${t}` });
const change = (t, currentPassword, newPassword) => request(app).post("/api/auth/change-password").set(as(t)).send({ currentPassword, newPassword });

test("password rules", () => {
  expect(passwordProblems("Abcdefg1")).toEqual([]);
  expect(passwordProblems("short1A")).toEqual(["at least 8 characters"]);
  expect(passwordProblems("alllower1")).toEqual(["an upper-case letter"]);
  expect(passwordProblems("ALLUPPER1")).toEqual(["a lower-case letter"]);
  expect(passwordProblems("NoDigitsHere")).toEqual(["a digit"]);
});

describe("forced reset", () => {
  let u;
  let token;
  beforeAll(async () => {
    u = await createTempUser("student", { mustReset: true, password: "Temp-pass1" });
    temps.push(u);
    const res = await signIn(u);
    expect(res.body.mustResetPassword).toBe(true);
    token = res.body.token;
  });

  test("blocks every other route with 403 PASSWORD_RESET_REQUIRED", async () => {
    for (const path of ["/api/notifications/mine", "/api/student/dashboard", "/api/student/next-steps"]) {
      const res = await request(app).get(path).set(as(token));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PASSWORD_RESET_REQUIRED");
    }
  });

  test("me and logout stay allowed", async () => {
    const me = await request(app).get("/api/auth/me").set(as(token));
    expect(me.status).toBe(200);
    expect(me.body.mustResetPassword).toBe(true);
    expect((await request(app).post("/api/auth/logout").set(as(token))).status).toBe(200);
  });

  test("change-password checks the current password, the rules and reuse", async () => {
    expect((await change(token, "wrong-Pass1", "NewPass123")).status).toBe(401);
    const weak = await change(token, u.password, "weakpass");
    expect(weak.status).toBe(400);
    expect(weak.body.details).toEqual(expect.arrayContaining(["an upper-case letter", "a digit"]));
    expect((await change(token, u.password, u.password)).status).toBe(400);
    expect((await request(app).post("/api/auth/change-password").set(as(token)).send({})).status).toBe(400);
  });

  test("a successful change returns a fresh token and unblocks the account", async () => {
    const res = await change(token, u.password, "NewPass123");
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.mustResetPassword).toBe(false);
    expect((await request(app).get("/api/notifications/mine").set(as(res.body.token))).status).toBe(200);
    // the old token works too: the block lives on the account, not in the token
    expect((await request(app).get("/api/notifications/mine").set(as(token))).status).toBe(200);
    expect((await signIn(u, "NewPass123")).body.mustResetPassword).toBe(false);
    expect((await signIn(u)).status).toBe(401);
  });
});

test("a user without a pending reset can change their password voluntarily", async () => {
  const u = await createTempUser("faculty", { password: "Faculty-1x" });
  temps.push(u);
  const { body } = await signIn(u);
  const res = await change(body.token, u.password, "Another-Pass9");
  expect(res.status).toBe(200);
  expect((await signIn(u, "Another-Pass9")).status).toBe(200);
});
