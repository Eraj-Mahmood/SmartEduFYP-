const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");

/**
 * POST /api/auth/login
 * Single login endpoint for student / faculty / admin.
 * The `role` returned tells the frontend which portal to redirect to -
 * but the ACTUAL enforcement happens server-side via authorize() on every route.
 */
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT user_id, email, password_hash, role, is_active, must_reset_pw FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: "This account has been deactivated. Contact admin." });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
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

/** POST /api/auth/logout - tokens are stateless; this exists so the client can always call it
 *  (it stays allowed while a password change is pending). */
async function logout(req, res) {
  return res.json({ message: "Logged out" });
}

module.exports = { login, changePassword, me, logout, passwordProblems };
