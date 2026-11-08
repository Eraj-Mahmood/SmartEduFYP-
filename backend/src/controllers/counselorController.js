const pool = require("../config/db");
const { sendError } = require("../middleware/errors");
const { logAction } = require("../middleware/audit");
const svc = require("../services/counselors");

// Counselor assignments (FR12). Admin: assign / reassign / close / list / workload.
// Faculty: their own active counselees only (403 for anyone else's).

const fail = (res, err) => sendError(res, err, "Could not complete the counselor request");

// ---------------- admin ----------------

/** POST /api/admin/counselors {studentId, facultyId} */
async function assign(req, res) {
  try {
    const { studentId, facultyId } = req.body;
    const { assignment, closed } = await svc.assignCounselor({ studentId, facultyId, adminUserId: req.user.userId });
    await logAction(req.user.userId, closed ? "REASSIGN_COUNSELOR" : "ASSIGN_COUNSELOR", "counselor_assignments", assignment.id, {
      student_id: studentId,
      roll_no: assignment.roll_no,
      faculty_id: facultyId,
      faculty: assignment.faculty_name,
      prediction_id: assignment.prediction_id,
      closed_assignment_id: closed,
    });
    res.status(201).json({ ...assignment, closed_assignment_id: closed });
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/admin/counselors/:id/close */
async function close(req, res) {
  try {
    const a = await svc.closeAssignment(req.params.id);
    await logAction(req.user.userId, "CLOSE_COUNSELOR", "counselor_assignments", a.id, { roll_no: a.roll_no, faculty: a.faculty_name, by: "admin" });
    res.json(a);
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/counselors?status=active|closed&department=<id>&faculty=<id>&page&limit */
async function list(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const where = [];
    const params = [];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (["active", "closed"].includes(req.query.status)) add("ca.status = ?", req.query.status);
    if (parseInt(req.query.department)) add("s.department_id = ?", parseInt(req.query.department));
    if (parseInt(req.query.faculty)) add("ca.faculty_id = ?", parseInt(req.query.faculty));
    const from = `FROM counselor_assignments ca
      JOIN students s ON s.student_id = ca.student_id
      JOIN departments sd ON sd.department_id = s.department_id
      JOIN faculty f ON f.faculty_id = ca.faculty_id
      LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
    const [count, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total ${from}`, params),
      pool.query(
        `SELECT ca.id, ca.status, ca.student_id, s.roll_no, s.full_name AS student_name, sd.code AS student_department,
                ca.faculty_id, f.full_name AS faculty_name, p.final_label, ca.prediction_id,
                ca.last_contacted_at, ca.created_at, ca.closed_at
         ${from}
         ORDER BY ca.status, ca.created_at DESC, ca.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
    ]);
    const total = count.rows[0].total;
    res.json({ rows: rows.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/admin/faculty/workload?department=<id> - active counselees per faculty member.
 *  With department, that department's faculty come first (for the assign picker). */
async function workload(req, res) {
  try {
    const dept = parseInt(req.query.department) || 0;
    const { rows } = await pool.query(
      `SELECT f.faculty_id, f.full_name, f.designation, f.department_id, d.code AS department_code,
              d.name AS department, u.email,
              COUNT(ca.id)::int AS active_counselees
       FROM faculty f
       JOIN users u ON u.user_id = f.user_id AND u.is_active
       JOIN departments d ON d.department_id = f.department_id
       LEFT JOIN counselor_assignments ca ON ca.faculty_id = f.faculty_id AND ca.status = 'active'
       GROUP BY f.faculty_id, d.department_id, u.email
       ORDER BY (f.department_id = $1) DESC, active_counselees, f.full_name`,
      [dept]
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
}

// ---------------- faculty ----------------

async function myFacultyId(userId) {
  const { rows } = await pool.query("SELECT faculty_id FROM faculty WHERE user_id = $1", [userId]);
  if (!rows.length) throw svc.httpError(403, "Faculty profile not found");
  return rows[0].faculty_id;
}

/** The faculty member's own ACTIVE assignment, else 403 (someone else's or closed) / 404 (no such id). */
async function ownAssignment(facultyId, id) {
  const [mine] = await svc.facultyAssignments(facultyId, { id });
  if (mine) return mine;
  const { rows } = await pool.query("SELECT 1 FROM counselor_assignments WHERE id = $1", [id]);
  throw rows.length ? svc.httpError(403, "This student is not your counselee") : svc.httpError(404, "Counselee not found");
}

/** GET /api/faculty/counselees - my active counselees with their summaries */
async function myCounselees(req, res) {
  try {
    const facultyId = await myFacultyId(req.user.userId);
    const rows = await svc.facultyAssignments(facultyId);
    res.json(await Promise.all(rows.map(svc.counseleeSummary)));
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/faculty/counselees/:id - one of my counselees */
async function oneCounselee(req, res) {
  try {
    const facultyId = await myFacultyId(req.user.userId);
    res.json(await svc.counseleeSummary(await ownAssignment(facultyId, req.params.id)));
  } catch (err) {
    fail(res, err);
  }
}

/** PUT /api/faculty/counselees/:id {notes?, last_contacted_at?, close?} */
async function updateCounselee(req, res) {
  try {
    const facultyId = await myFacultyId(req.user.userId);
    const a = await ownAssignment(facultyId, req.params.id);
    const { notes, last_contacted_at: contacted, close: closeIt } = req.body;
    const sets = [];
    const params = [];
    if (notes !== undefined) {
      params.push(notes === "" ? null : notes);
      sets.push(`notes = $${params.length}`);
    }
    if (contacted !== undefined) {
      params.push(contacted);
      sets.push(`last_contacted_at = $${params.length}`);
    }
    if (closeIt) sets.push("status = 'closed'", "closed_at = NOW()");
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    params.push(a.id);
    await pool.query(`UPDATE counselor_assignments SET ${sets.join(", ")} WHERE id = $${params.length}`, params);

    const fields = Object.keys(req.body).filter((k) => ["notes", "last_contacted_at", "close"].includes(k));
    await logAction(req.user.userId, closeIt ? "CLOSE_COUNSELOR" : "UPDATE_COUNSELEE", "counselor_assignments", a.id, {
      roll_no: a.roll_no,
      fields,
      ...(closeIt ? { by: "faculty" } : {}),
    });
    const { rows } = await pool.query("SELECT * FROM counselor_assignments WHERE id = $1", [a.id]);
    const updated = { ...a, ...rows[0] };
    res.json(closeIt ? { id: a.id, status: "closed", closed_at: updated.closed_at } : await svc.counseleeSummary(updated));
  } catch (err) {
    fail(res, err);
  }
}

module.exports = { assign, close, list, workload, myCounselees, oneCounselee, updateCounselee };
