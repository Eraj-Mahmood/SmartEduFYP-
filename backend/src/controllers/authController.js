const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

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

    const token = jwt.sign(
      { userId: user.user_id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

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

/**
 * POST /api/auth/change-password
 * Any logged-in user can change their own password (required on first login
 * for admin-issued credentials).
 */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  try {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE user_id = $1", [req.user.userId]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_reset_pw = FALSE, updated_at = NOW() WHERE user_id = $2",
      [newHash, req.user.userId]
    );
    return res.json({ message: "Password updated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error updating password" });
  }
}

/** GET /api/auth/me - used by frontend on refresh to re-hydrate session */
async function me(req, res) {
  return res.json({ userId: req.user.userId, role: req.user.role, email: req.user.email });
}

module.exports = { login, changePassword, me };
