const pool = require("../config/db");
const { sendError } = require("../middleware/errors");
const { logAction } = require("../middleware/audit");

// Admin management of study material per course (FR11). Every change is audit-logged.

const COLUMNS = `t.tutorial_id, t.course_id, c.course_code, c.title AS course_title, d.code AS department_code,
       t.title, t.url, t.provider, t.kind, t.description, t.is_active, t.created_by, t.created_at`;
const FROM = `FROM tutorials t JOIN courses c ON c.course_id = t.course_id JOIN departments d ON d.department_id = c.department_id`;
const FIELDS = ["course_id", "title", "url", "provider", "kind", "description", "is_active"];

async function getTutorial(id, db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} ${FROM} WHERE t.tutorial_id = $1`, [id]);
  return rows[0] || null;
}

function dbError(res, err) {
  if (err.code === "23505") return res.status(409).json({ error: "That course already has a tutorial with this link." });
  if (err.code === "23503") return res.status(400).json({ error: "Invalid course selected." });
  if (err.code === "23514") return res.status(400).json({ error: "Invalid tutorial (url must start with http:// or https://, kind must be video, notes or practice)." });
  return sendError(res, err, "Could not save the tutorial");
}

/** GET /api/admin/tutorials?courseId= - every tutorial (active and inactive), by course */
async function list(req, res) {
  try {
    const params = [];
    let where = "";
    if (req.query.courseId !== undefined) {
      const id = parseInt(req.query.courseId);
      if (!(id > 0)) return res.status(400).json({ error: "courseId must be a positive integer" });
      params.push(id);
      where = "WHERE t.course_id = $1";
    }
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} ${FROM} ${where} ORDER BY c.course_code, t.is_active DESC, t.tutorial_id`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendError(res, err, "Could not load the tutorials");
  }
}

/** POST /api/admin/tutorials {course_id, title, url, provider?, kind, description?} */
async function create(req, res) {
  try {
    const b = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tutorials (course_id, title, url, provider, kind, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING tutorial_id`,
      [b.course_id, b.title, b.url, b.provider || null, b.kind, b.description || null, req.user.userId]
    );
    const t = await getTutorial(rows[0].tutorial_id);
    await logAction(req.user.userId, "CREATE_TUTORIAL", "tutorials", t.tutorial_id, { course: t.course_code, url: t.url });
    res.status(201).json(t);
  } catch (err) {
    dbError(res, err);
  }
}

/** PUT /api/admin/tutorials/:id - change any of FIELDS (only the ones sent) */
async function update(req, res) {
  try {
    const before = await getTutorial(req.params.id);
    if (!before) return res.status(404).json({ error: "Tutorial not found" });
    const sets = [];
    const params = [];
    const changes = {};
    for (const f of FIELDS) {
      if (req.body[f] === undefined) continue;
      params.push(req.body[f] === "" && (f === "provider" || f === "description") ? null : req.body[f]);
      sets.push(`${f} = $${params.length}`);
      if (String(before[f]) !== String(req.body[f])) changes[f] = { from: before[f], to: req.body[f] };
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    params.push(req.params.id);
    await pool.query(`UPDATE tutorials SET ${sets.join(", ")} WHERE tutorial_id = $${params.length}`, params);
    const t = await getTutorial(req.params.id);
    await logAction(req.user.userId, "UPDATE_TUTORIAL", "tutorials", t.tutorial_id, { course: t.course_code, changes });
    res.json(t);
  } catch (err) {
    dbError(res, err);
  }
}

/** PUT /api/admin/tutorials/:id/deactivate */
async function deactivate(req, res) {
  try {
    const { rowCount } = await pool.query("UPDATE tutorials SET is_active = FALSE WHERE tutorial_id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Tutorial not found" });
    const t = await getTutorial(req.params.id);
    await logAction(req.user.userId, "DEACTIVATE_TUTORIAL", "tutorials", t.tutorial_id, { course: t.course_code, url: t.url });
    res.json(t);
  } catch (err) {
    sendError(res, err, "Could not deactivate the tutorial");
  }
}

module.exports = { list, create, update, deactivate };
