const { validationResult } = require("express-validator");

/** Runs after express-validator chains: 400 with every message if any check failed. */
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array().map((e) => e.msg);
  res.status(400).json({ error: details.join("; "), details });
}

module.exports = { validate };
