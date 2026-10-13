const pool = require("../config/db");

/**
 * Fire-and-forget audit log write. Call this from controllers whenever
 * faculty edits results/attendance or admin assigns/drops/sends notifications.
 */
async function logAction(actorUserId, action, entity, entityId, details = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorUserId, action, entity, entityId, JSON.stringify(details)]
    );
  } catch (err) {
    // Never let audit logging break the main request
    console.error("audit log failed:", err.message);
  }
}

module.exports = { logAction };
