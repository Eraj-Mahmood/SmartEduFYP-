const pool = require("../config/db");

/** GET /api/notifications/mine - every notification addressed to the logged-in user */
async function mine(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT notification_id, subject, message, sent_at, read_at
       FROM notifications
       WHERE recipient_user_id = $1
       ORDER BY sent_at DESC
       LIMIT 50`,
      [req.user.userId]
    );
    const unreadCount = rows.filter((r) => !r.read_at).length;
    res.json({ notifications: rows, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** PUT /api/notifications/:id/read - mark a single notification as read */
async function markRead(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE notification_id = $1 AND recipient_user_id = $2
       RETURNING *`,
      [req.params.id, req.user.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Notification not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** PUT /api/notifications/read-all - mark everything as read (e.g. "mark all as read" button) */
async function markAllRead(req, res) {
  try {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [req.user.userId]
    );
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { mine, markRead, markAllRead };
