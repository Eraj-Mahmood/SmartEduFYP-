const jwt = require("jsonwebtoken");

/**
 * Verifies the JWT sent in the Authorization header and attaches
 * { userId, role, email } to req.user. Every protected route uses this.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, role, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
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
