const jwt = require("jsonwebtoken");
const pool = require("../config/db");

// While must_reset_pw is TRUE these are the only routes a token may use.
const RESET_ALLOWED = new Set(["/api/auth/change-password", "/api/auth/me", "/api/auth/logout"]);

/**
 * Verifies the JWT sent in the Authorization header and attaches
 * { userId, role, email, mustResetPw } to req.user. Every protected route uses this.
 * One primary-key lookup per request rejects tokens of deactivated (or deleted) users
 * straight away, instead of letting them work until the token expires. The same lookup
 * enforces the forced password change: while must_reset_pw is TRUE every route except
 * RESET_ALLOWED answers 403 PASSWORD_RESET_REQUIRED.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const { rows } = await pool.query("SELECT is_active, must_reset_pw FROM users WHERE user_id = $1", [payload.userId]);
    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: "This account has been deactivated. Contact admin.", code: "ACCOUNT_DISABLED" });
    }
    req.user = { userId: payload.userId, role: payload.role, email: payload.email, mustResetPw: rows[0].must_reset_pw };
    if (req.user.mustResetPw && !RESET_ALLOWED.has(req.originalUrl.split("?")[0].replace(/\/+$/, ""))) {
      return res.status(403).json({ error: "Please change your password before continuing.", code: "PASSWORD_RESET_REQUIRED" });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restricts a route to one or more roles.
 * Usage: authorize('admin'), authorize('faculty', 'admin')
 * This is what makes "student signs in -> student portal, faculty -> faculty
 * portal, admin -> admin portal" actually enforced server-side (not just UI).
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role permissions" });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
