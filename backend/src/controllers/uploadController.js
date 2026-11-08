const pool = require("../config/db");
const { sendError } = require("../middleware/errors");
const { logAction } = require("../middleware/audit");
const { processClassUpload, classTemplate, KINDS } = require("../services/uploads");

// Faculty bulk uploads (FR13): CSV templates, preview/commit and upload history.

async function myFacultyId(userId) {
  const { rows } = await pool.query("SELECT faculty_id FROM faculty WHERE user_id = $1", [userId]);
  if (!rows.length) throw Object.assign(new Error("Faculty profile not found"), { status: 403 });
  return rows[0].faculty_id;
}

/** The class row if it is this faculty member's, else 403. */
async function ownClass(facultyId, facultyCourseId) {
  const { rows } = await pool.query(
    `SELECT fc.faculty_course_id, fc.section, c.course_code, c.title
     FROM faculty_courses fc JOIN courses c ON c.course_id = fc.course_id
     WHERE fc.faculty_course_id = $1 AND fc.faculty_id = $2`,
    [facultyCourseId, facultyId]
  );
  if (!rows.length) throw Object.assign(new Error("You are not assigned to this class"), { status: 403 });
  return rows[0];
}

/** GET /api/faculty/classes/:id/templates/(results|attendance).csv - prefilled with the roster. */
async function template(req, res) {
  try {
    const kind = String(req.params.template || "").replace(/\.csv$/i, "");
    if (!KINDS[kind]) return res.status(404).json({ error: "Templates: results.csv or attendance.csv" });
    const cls = await ownClass(await myFacultyId(req.user.userId), req.params.facultyCourseId);
    const csv = await classTemplate(cls.faculty_course_id, kind);
    const name = `${kind}_${cls.course_code}_${cls.section}.csv`.replace(/[^\w.-]/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(csv);
  } catch (err) {
    sendError(res, err, "Could not build the template");
  }
}

/** POST /api/faculty/classes/:id/upload?kind=results|attendance&mode=preview|commit (multipart "file"). */
async function upload(req, res) {
  try {
    const cls = await ownClass(await myFacultyId(req.user.userId), req.params.facultyCourseId);
    const kind = String(req.query.kind || "");
    const mode = String(req.query.mode || "preview");
    const out = await processClassUpload({ facultyCourseId: cls.faculty_course_id, userId: req.user.userId, kind, mode, file: req.file });
    if (mode === "commit") {
      await logAction(req.user.userId, KINDS[kind].audit, "uploads", out.upload.id, {
        class: `${cls.course_code} ${cls.section}`,
        filename: out.upload.filename,
        status: out.upload.status,
        ...out.summary,
        repredicted: out.repredicted,
        labels_changed: out.labels_changed.length,
      });
    }
    res.json({ ...out, class: cls });
  } catch (err) {
    if (!err.status) console.error(err);
    sendError(res, err, "Could not process the file");
  }
}

/** GET /api/faculty/uploads?limit=50 - my upload history, newest first. */
async function history(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    // another faculty member's class: 403 (documented contract), not just an empty list
    if (parseInt(req.query.classId)) await ownClass(await myFacultyId(req.user.userId), parseInt(req.query.classId));
    const { rows } = await pool.query(
      `SELECT u.id, u.kind, u.filename, u.status, u.rows_total, u.rows_ok, u.rows_failed, u.summary,
              u.created_at, u.committed_at, u.faculty_course_id, c.course_code, fc.section,
              jsonb_array_length(u.errors) AS error_count
       FROM uploads u
       LEFT JOIN faculty_courses fc ON fc.faculty_course_id = u.faculty_course_id
       LEFT JOIN courses c ON c.course_id = fc.course_id
       WHERE u.uploaded_by = $1 ${parseInt(req.query.classId) ? "AND u.faculty_course_id = $3" : ""}
       ORDER BY u.created_at DESC, u.id DESC LIMIT $2`,
      parseInt(req.query.classId) ? [req.user.userId, limit, parseInt(req.query.classId)] : [req.user.userId, limit]
    );
    res.json(rows);
  } catch (err) {
    sendError(res, err, "Could not load the upload history");
  }
}

module.exports = { template, upload, history, ownClass, myFacultyId };
