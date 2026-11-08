const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");

const PORTALS = ["student", "faculty", "admin"];
const PORTAL_NAMES = { student: "Student", faculty: "Faculty", admin: "Admin" };
const GENERIC_401 = { error: "Invalid email or password" };
// compared against when the email is unknown, so an unknown email takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync("smartedu-no-such-user", 10);

/**
 * POST /api/auth/login {email, password, portal}
 * One endpoint, three portals (student | faculty | admin). Order: rate limit (app.js) -> input
 * (missing / invalid portal: 400) -> credentials (unknown email or wrong password: the same generic
 * 401 on every portal) -> deactivated (403) -> portal: the password is right but the account's role
 * belongs to another portal -> 403 WRONG_PORTAL with correctPortal, no token, audit-logged.
 * The `role` returned tells the frontend which portal to redirect to -
 * but the ACTUAL enforcement happens server-side via authorize() on every route.
 */
async function login(req, res) {
  const { email, password, portal } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (!PORTALS.includes(portal)) {
    return res.status(400).json({ error: "portal must be one of: student, faculty, admin" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT user_id, email, password_hash, role, is_active, must_reset_pw FROM users WHERE email = $1",
      [String(email).toLowerCase().trim()]
    );

    const user = rows[0];
    const match = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
    if (!user || !match) {
      return res.status(401).json(GENERIC_401);
    }

    if (!user.is_active) {
      return res.status(403).json({ error: "This account has been deactivated. Contact admin." });
    }

    if (user.role !== portal) {
      await logAction(user.user_id, "LOGIN_WRONG_PORTAL", "users", user.user_id, { portal, correctPortal: user.role });
      return res.status(403).json({
        error: `This is a ${user.role} account - please use the ${PORTAL_NAMES[user.role]} sign in`,
        code: "WRONG_PORTAL",
        correctPortal: user.role,
      });
    }

    // Pull the role-specific profile id (student_id / faculty_id) so the
    // frontend doesn't need a second round trip before showing the dashboard.
    let profile = null;
    if (user.role === "student") {
      const p = await pool.query(
        "SELECT student_id, roll_no, full_name, department_id, current_semester FROM students WHERE user_id = $1",
        [user.user_id]
      );
      profile = p.rows[0] || null;
    } else if (user.role === "faculty") {
      const p = await pool.query(
        "SELECT faculty_id, employee_no, full_name, department_id FROM faculty WHERE user_id = $1",
        [user.user_id]
      );
      profile = p.rows[0] || null;
    }

    const token = signToken(user);

    return res.json({
      token,
      role: user.role,               // frontend routes to /student, /faculty, or /admin based on this
      mustResetPassword: user.must_reset_pw,
      profile,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error during login" });
  }
}

function signToken(user) {
  return jwt.sign(
    // iatMs: issue time in ms, compared with users.password_changed_at by authenticate()
    { userId: user.user_id, role: user.role, email: user.email, iatMs: Date.now() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

/** The password rules, as a list of the ones that fail (empty = acceptable). Shared with tests. */
function passwordProblems(pw) {
  const p = String(pw || "");
  const out = [];
  if (p.length < 8) out.push("at least 8 characters");
  if (!/[A-Z]/.test(p)) out.push("an upper-case letter");
  if (!/[a-z]/.test(p)) out.push("a lower-case letter");
  if (!/[0-9]/.test(p)) out.push("a digit");
  return out;
}

/**
 * POST /api/auth/change-password {currentPassword, newPassword}
 * Any logged-in user can change their own password; it is required on first login for
 * admin-issued credentials (must_reset_pw). The new password needs 8+ characters with upper
 * case, lower case and a digit, and must differ from the current one. Returns a fresh token;
 * every token issued before the change stops working (401 TOKEN_REVOKED).
 */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  const problems = passwordProblems(newPassword);
  if (problems.length) {
    return res.status(400).json({ error: `New password needs ${problems.join(", ")}.`, details: problems });
  }
  if (newPassword.length > 200) return res.status(400).json({ error: "New password is too long" });

  try {
    const { rows } = await pool.query("SELECT user_id, email, role, password_hash FROM users WHERE user_id = $1", [req.user.userId]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect", code: "WRONG_PASSWORD" });
    if (newPassword === currentPassword || (await bcrypt.compare(newPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: "The new password must be different from your current one." });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    // Node's clock (not the DB's), so the fresh token below is always issued after this instant
    // and every earlier token is revoked (middleware/auth.js).
    await pool.query(
      "UPDATE users SET password_hash = $1, must_reset_pw = FALSE, password_changed_at = $3, updated_at = NOW() WHERE user_id = $2",
      [newHash, req.user.userId, new Date()]
    );
    await logAction(req.user.userId, "CHANGE_PASSWORD", "users", req.user.userId, { forced: !!req.user.mustResetPw });
    return res.json({ message: "Password updated", token: signToken(rows[0]), role: rows[0].role, mustResetPassword: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error updating password" });
  }
}

/** GET /api/auth/me - used by frontend on refresh to re-hydrate session */
async function me(req, res) {
  return res.json({ userId: req.user.userId, role: req.user.role, email: req.user.email, mustResetPassword: !!req.user.mustResetPw });
}

/**
 * POST /api/auth/logout - revokes the user's tokens: sets users.sessions_revoked_at (migration 012) and
 * authenticate() rejects every token issued before it with 401 TOKEN_REVOKED. Tokens are not stored
 * per device, so this signs the user out on ALL devices, not just this one.
 * Node's clock (not the DB's), like changePassword, so a token signed after this instant is never caught.
 * Stays allowed while a password change is pending.
 */
async function logout(req, res) {
  try {
    await pool.query("UPDATE users SET sessions_revoked_at = $2 WHERE user_id = $1", [req.user.userId, new Date()]);
    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error signing out" });
  }
}

module.exports = { login, changePassword, me, logout, passwordProblems };
