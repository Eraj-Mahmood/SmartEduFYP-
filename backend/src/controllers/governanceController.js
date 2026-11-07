const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { staffReasons } = require("../services/reasons");
const { latestFilters } = require("./adminController");

// Admin governance: account activation, the audit-log viewer and the flagged-students CSV.

// ---------------- account activation ----------------

async function setActive(req, res, active) {
  try {
    const userId = Number(req.params.userId);
    if (!active && userId === req.user.userId) return res.status(400).json({ error: "You can't deactivate your own account." });
    const { rows } = await pool.query(
      "UPDATE users SET is_active = $1, updated_at = NOW() WHERE user_id = $2 RETURNING user_id, email, role, is_active",
      [active, userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    await logAction(req.user.userId, active ? "REACTIVATE_USER" : "DEACTIVATE_USER", "users", userId, { email: rows[0].email, role: rows[0].role });
    res.json({ message: active ? "User reactivated" : "User deactivated", user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** PUT /api/admin/users/:userId/deactivate - their existing tokens stop working at once (auth middleware) */
const deactivateUser = (req, res) => setActive(req, res, false);
/** PUT /api/admin/users/:userId/reactivate */
const reactivateUser = (req, res) => setActive(req, res, true);

// ---------------- audit log ----------------

/**
 * GET /api/admin/audit-log?page&limit&actor&action&entity&from&to
 * actor: a user id or part of an email; from/to: dates (YYYY-MM-DD, inclusive).
 * -> {rows, total, page, limit, totalPages, actions, entities} (the last two fill the filters)
 */
async function auditLog(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const where = [];
    const params = [];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace(/\?/g, `$${params.length}`));
    };
    const actor = String(req.query.actor || "").trim();
    if (/^\d+$/.test(actor)) add("a.actor_user_id = ?", Number(actor));
    else if (actor) add("u.email ILIKE ?", `%${actor}%`);
    if (req.query.action) add("a.action = ?", String(req.query.action));
    if (req.query.entity) add("a.entity = ?", String(req.query.entity));
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
    if (req.query.from) {
      if (!isDate(req.query.from)) return res.status(400).json({ error: "from must be a date (YYYY-MM-DD)" });
      add("a.created_at >= ?::date", req.query.from);
    }
    if (req.query.to) {
      if (!isDate(req.query.to)) return res.status(400).json({ error: "to must be a date (YYYY-MM-DD)" });
      add("a.created_at < ?::date + 1", req.query.to);
    }
    const from = `FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    const [count, rows, actions, entities] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total ${from}`, params),
      pool.query(
        `SELECT a.log_id, a.created_at, a.actor_user_id, u.email AS actor_email, u.role AS actor_role,
                a.action, a.entity, a.entity_id, a.details
         ${from} ORDER BY a.created_at DESC, a.log_id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
      pool.query("SELECT DISTINCT action FROM audit_log ORDER BY action"),
      pool.query("SELECT DISTINCT entity FROM audit_log ORDER BY entity"),
    ]);
    const total = count.rows[0].total;
    res.json({
      rows: rows.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      actions: actions.rows.map((r) => r.action),
      entities: entities.rows.map((r) => r.entity),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---------------- flagged students CSV ----------------

const CSV_COLUMNS = ["roll_no", "name", "department", "label", "top_reason", "weakest_course", "counselor", "last_intervention"];

/** One CSV field: quoted, with a leading ' when it could be read as a spreadsheet formula. */
function csvField(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CHUNK = 2000;

/**
 * GET /api/admin/at-risk-students/export - the flagged-students list as CSV, same filters as
 * GET /at-risk-students (label, department, semester, search, noCounselor, notContacted),
 * most severe first. Streams in chunks; UTF-8 with a BOM so Excel shows names correctly.
 */
async function exportAtRisk(req, res) {
  try {
    const { where, params } = latestFilters(req.query, { riskOnly: true });
    const { rows: ids } = await pool.query(
      `SELECT s.student_id FROM students s JOIN users u ON u.user_id = s.user_id
       JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY CASE p.final_label WHEN 'Dropout-Likely' THEN 0 WHEN 'At-Risk' THEN 1 ELSE 2 END, s.roll_no`,
      params
    );
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="flagged-students-${day}.csv"`);
    res.write(`﻿${CSV_COLUMNS.join(",")}\r\n`);

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK).map((r) => r.student_id);
      const { rows } = await pool.query(
        `WITH ids AS (SELECT unnest($1::int[]) AS student_id, generate_subscripts($1::int[], 1) AS ord),
         weakest AS (
           SELECT DISTINCT ON (e.student_id) e.student_id, c.course_code,
                  (cr.assignment_avg + cr.quiz_avg + cr.midterm_marks + cr.final_marks) / 4 AS mean
           FROM enrollments e
           JOIN ids ON ids.student_id = e.student_id
           JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
           JOIN courses c ON c.course_id = fc.course_id
           JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE a.status = 'present')::numeric / NULLIF(COUNT(*), 0) AS att
             FROM attendance a WHERE a.enrollment_id = e.enrollment_id
           ) att ON TRUE
           WHERE e.status = 'enrolled' AND cr.assignment_avg IS NOT NULL
           ORDER BY e.student_id, mean, att.att NULLS LAST
         )
         SELECT s.roll_no, s.full_name, d.name AS department, p.final_label, p.reasons, p.drivers, p.features,
                w.course_code AS weakest_course, w.mean AS weakest_mean, f.full_name AS counselor,
                (SELECT to_char(MAX(n.sent_at), 'YYYY-MM-DD HH24:MI') FROM notifications n
                 WHERE n.recipient_user_id = s.user_id AND COALESCE(n.kind, 'intervention') = 'intervention') AS last_intervention
         FROM ids
         JOIN students s ON s.student_id = ids.student_id
         JOIN departments d ON d.department_id = s.department_id
         JOIN predictions p ON p.prediction_id = s.latest_prediction_id
         LEFT JOIN weakest w ON w.student_id = s.student_id
         LEFT JOIN counselor_assignments ca ON ca.student_id = s.student_id AND ca.status = 'active'
         LEFT JOIN faculty f ON f.faculty_id = ca.faculty_id
         ORDER BY ids.ord`,
        [chunk]
      );
      const lines = rows.map((r) =>
        [
          r.roll_no,
          r.full_name,
          r.department,
          r.final_label,
          staffReasons(r)[0] || "",
          r.weakest_course ? `${r.weakest_course} (avg ${Math.round(Number(r.weakest_mean))})` : "",
          r.counselor || "",
          r.last_intervention || "", // database local time
        ]
          .map(csvField)
          .join(",")
      );
      if (lines.length) res.write(`${lines.join("\r\n")}\r\n`);
    }
    res.end();
    await logAction(req.user.userId, "EXPORT_FLAGGED_CSV", "students", null, { rows: ids.length, filters: req.query });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
}

module.exports = { deactivateUser, reactivateUser, auditLog, exportAtRisk, csvField, CSV_COLUMNS };
