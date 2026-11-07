const request = require("supertest");
const app = require("../src/app");
const { login, createTempUser, dropTempUser, pool } = require("./helpers");
const { passwordProblems } = require("../src/controllers/authController");

// Admin password reset (Phase 6 step 4): PUT /api/admin/users/:userId/reset-password.

const as = (t) => ({ Authorization: `Bearer ${t}` });
const reset = (t, userId) => request(app).put(`/api/admin/users/${userId}/reset-password`).set(as(t));
const signIn = (email, password, portal) => request(app).post("/api/auth/login").send({ email, password, portal });

let admin, adminId, faculty, student;
const temps = [];
let liveSnapshot = null;

beforeAll(async () => {
  [admin, faculty, student] = await Promise.all([
    login(app, "admin@smartedu.edu", "admin"),
    login(app, "ayesha.khan@smartedu.edu", "faculty"),
    login(app, "student100040@smartedu.edu", "student"),
  ]);
  adminId = (await pool.query("SELECT user_id FROM users WHERE email = 'admin@smartedu.edu'")).rows[0].user_id;
});

afterAll(async () => {
  if (liveSnapshot) {
    await pool.query(
      "UPDATE users SET password_hash = $2, must_reset_pw = $3, password_changed_at = $4::timestamptz WHERE user_id = $1",
      [liveSnapshot.user_id, liveSnapshot.password_hash, liveSnapshot.must_reset_pw, liveSnapshot.changed_text]
    );
    await pool.query("DELETE FROM audit_log WHERE action = 'RESET_PASSWORD' AND entity_id = $1", [liveSnapshot.user_id]);
  }
  for (const u of temps) await dropTempUser(u.userId);
  await pool.query("DELETE FROM audit_log WHERE action = 'RESET_PASSWORD' AND entity_id = ANY($1)", [temps.map((u) => u.userId)]);
  await pool.end();
});

describe("reset-password", () => {
  let u, oldToken, temp;

  beforeAll(async () => {
    u = await createTempUser("student", { password: "Old-pass1" });
    temps.push(u);
    oldToken = (await signIn(u.email, "Old-pass1", "student")).body.token;
    expect(oldToken).toBeTruthy();
  });

  test("returns a temporary password once, valid under the password rules, not cached", async () => {
    const res = await reset(admin, u.userId);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.user).toMatchObject({ user_id: u.userId, email: u.email, role: "student" });
    temp = res.body.tempPassword;
    expect(temp).toMatch(/^[A-Za-z2-9]{12}$/);
    expect(passwordProblems(temp)).toEqual([]);
    const { rows } = await pool.query("SELECT must_reset_pw, password_changed_at FROM users WHERE user_id = $1", [u.userId]);
    expect(rows[0].must_reset_pw).toBe(true);
    expect(Date.now() - new Date(rows[0].password_changed_at).getTime()).toBeLessThan(60000);
  });

  test("the old token gets 401 and the old password no longer works", async () => {
    const me = await request(app).get("/api/auth/me").set(as(oldToken));
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("TOKEN_REVOKED");
    const old = await signIn(u.email, "Old-pass1", "student");
    expect(old.status).toBe(401);
    expect(old.body).toEqual({ error: "Invalid email or password" });
  });

  test("the new login is forced to change the password first", async () => {
    const res = await signIn(u.email, temp, "student");
    expect(res.status).toBe(200);
    expect(res.body.mustResetPassword).toBe(true);
    const blocked = await request(app).get("/api/notifications/mine").set(as(res.body.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_RESET_REQUIRED");
    const changed = await request(app).post("/api/auth/change-password").set(as(res.body.token)).send({ currentPassword: temp, newPassword: "Fresh-pass9" });
    expect(changed.status).toBe(200);
    const after = await signIn(u.email, "Fresh-pass9", "student");
    expect(after.body.mustResetPassword).toBe(false);
  });

  test("is audit-logged without the password", async () => {
    const { rows } = await pool.query(
      "SELECT actor_user_id, details FROM audit_log WHERE action = 'RESET_PASSWORD' AND entity = 'users' AND entity_id = $1",
      [u.userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(adminId);
    expect(rows[0].details).toEqual({ email: u.email, role: "student" });
    expect(JSON.stringify(rows[0].details)).not.toContain(temp);
  });
});

describe("access and input", () => {
  test("admin only: faculty and students get 403, no token gets 401", async () => {
    const u = await createTempUser("student");
    temps.push(u);
    expect((await reset(faculty, u.userId)).status).toBe(403);
    expect((await reset(student, u.userId)).status).toBe(403);
    expect((await request(app).put(`/api/admin/users/${u.userId}/reset-password`)).status).toBe(401);
    // nothing changed
    const { rows } = await pool.query("SELECT must_reset_pw FROM users WHERE user_id = $1", [u.userId]);
    expect(rows[0].must_reset_pw).toBe(false);
  });

  test("unknown user 404, bad id 400, own account 400", async () => {
    expect((await reset(admin, 99999999)).status).toBe(404);
    expect((await reset(admin, "abc")).status).toBe(400);
    const self = await reset(admin, adminId);
    expect(self.status).toBe(400);
    expect(self.body.tempPassword).toBeUndefined();
  });
});

describe("live-cohort students", () => {
  test("can sign in after an admin reset (their imported account has an unknown random password)", async () => {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.email, u.password_hash, u.must_reset_pw, u.password_changed_at::text AS changed_text
       FROM users u JOIN students s ON s.user_id = u.user_id WHERE s.data_source = 'live' ORDER BY s.roll_no LIMIT 1`
    );
    if (!rows.length) return; // no cohort imported
    liveSnapshot = rows[0];
    const res = await reset(admin, liveSnapshot.user_id);
    expect(res.status).toBe(200);
    const signedIn = await signIn(liveSnapshot.email, res.body.tempPassword, "student");
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.role).toBe("student");
    expect(signedIn.body.mustResetPassword).toBe(true);
    expect(signedIn.body.profile.roll_no).toMatch(/^SYN-/);
  });
});
