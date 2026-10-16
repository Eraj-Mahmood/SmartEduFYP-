const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { MARK_FIELDS, deriveGrade } = require("../services/grading");

async function getMyFacultyId(userId) {
  const { rows } = await pool.query("SELECT faculty_id FROM faculty WHERE user_id = $1", [userId]);
  if (rows.length === 0) throw new Error("Faculty profile not found");
  return rows[0].faculty_id;
}

/** Ensures the faculty_course actually belongs to the logged-in faculty member
 *  before any read/write - prevents Faculty A editing Faculty B's class. */
async function assertOwnsClass(facultyId, facultyCourseId) {
  const { rows } = await pool.query(
    "SELECT faculty_course_id FROM faculty_courses WHERE faculty_course_id = $1 AND faculty_id = $2",
    [facultyCourseId, facultyId]
  );
  if (rows.length === 0) {
    const e = new Error("You are not assigned to this class");
    e.status = 403;
    throw e;
  }
}

/** GET /api/faculty/classes - every subject/section this faculty teaches (can teach multiple) */
async function myClasses(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const { rows } = await pool.query(
      `SELECT fc.faculty_course_id, c.course_code, c.title, fc.section, fc.semester, fc.academic_year,
              (SELECT COUNT(*) FROM enrollments e WHERE e.faculty_course_id = fc.faculty_course_id AND e.status = 'enrolled') AS enrolled_count
       FROM faculty_courses fc
       JOIN courses c ON c.course_id = fc.course_id
       WHERE fc.faculty_id = $1
       ORDER BY fc.academic_year DESC, fc.semester DESC`,
      [facultyId]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** GET /api/faculty/classes/:facultyCourseId/roster */
async function classRoster(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const fcId = Number(req.params.facultyCourseId);
    await assertOwnsClass(facultyId, fcId);

    const { rows } = await pool.query(
      `SELECT e.enrollment_id, s.student_id, s.roll_no, s.full_name, e.status,
              cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks, cr.grade
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
       WHERE e.faculty_course_id = $1
       ORDER BY s.roll_no`,
      [fcId]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** PUT /api/faculty/results/:enrollmentId - enter/update a result (upsert) */
async function upsertResult(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const enrollmentId = Number(req.params.enrollmentId);

    // Verify this enrollment belongs to one of this faculty's classes
    const own = await pool.query(
      `SELECT e.enrollment_id FROM enrollments e
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       WHERE e.enrollment_id = $1 AND fc.faculty_id = $2`,
      [enrollmentId, facultyId]
    );
    if (own.rows.length === 0) return res.status(403).json({ error: "Not your class/student" });

    // Marks left out of the request keep their saved value (0 for a new result).
    // The grade is always derived on the server; a client-sent grade is ignored.
    const existing = await pool.query(
      `SELECT ${MARK_FIELDS.join(", ")} FROM course_results WHERE enrollment_id = $1`,
      [enrollmentId]
    );
    const marks = {};
    for (const f of MARK_FIELDS) marks[f] = req.body[f] ?? existing.rows[0]?.[f] ?? 0;
    const grade = deriveGrade(marks);

    const { rows } = await pool.query(
      `INSERT INTO course_results (enrollment_id, assignment_avg, quiz_avg, midterm_marks, final_marks, grade, updated_by, updated_at, data_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'live')
       ON CONFLICT (enrollment_id) DO UPDATE
         SET assignment_avg = EXCLUDED.assignment_avg,
             quiz_avg = EXCLUDED.quiz_avg,
             midterm_marks = EXCLUDED.midterm_marks,
             final_marks = EXCLUDED.final_marks,
             grade = EXCLUDED.grade,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW(),
             data_source = 'live'
       RETURNING *`,
      [enrollmentId, marks.assignment_avg, marks.quiz_avg, marks.midterm_marks, marks.final_marks, grade, req.user.userId]
    );

    await logAction(req.user.userId, "UPDATE_RESULT", "course_results", rows[0].result_id, { enrollmentId });
    res.json(rows[0]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** POST /api/faculty/attendance - mark attendance for one or more students on a date
 *  body: { facultyCourseId, classDate, entries: [{ enrollmentId, status }] } */
async function markAttendance(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const { facultyCourseId, classDate, entries } = req.body;
    await assertOwnsClass(facultyId, facultyCourseId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const results = [];
      for (const entry of entries) {
        const { rows } = await client.query(
          `INSERT INTO attendance (enrollment_id, class_date, status, marked_by, marked_at, data_source)
           VALUES ($1,$2,$3,$4,NOW(),'live')
           ON CONFLICT (enrollment_id, class_date) DO UPDATE
             SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = NOW(), data_source = 'live'
           RETURNING *`,
          [entry.enrollmentId, classDate, entry.status, req.user.userId]
        );
        results.push(rows[0]);
      }
      await client.query("COMMIT");
      await logAction(req.user.userId, "MARK_ATTENDANCE", "attendance", null, { facultyCourseId, classDate, count: entries.length });
      res.json(results);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** GET /api/faculty/classes/:facultyCourseId/attendance?date=YYYY-MM-DD */
async function classAttendance(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const fcId = Number(req.params.facultyCourseId);
    await assertOwnsClass(facultyId, fcId);

    const params = [fcId];
    let dateFilter = "";
    if (req.query.date) {
      params.push(req.query.date);
      dateFilter = "AND a.class_date = $2";
    }

    const { rows } = await pool.query(
      `SELECT a.attendance_id, a.enrollment_id, s.roll_no, s.full_name, a.class_date, a.status
       FROM attendance a
       JOIN enrollments e ON e.enrollment_id = a.enrollment_id
       JOIN students s ON s.student_id = e.student_id
       WHERE e.faculty_course_id = $1 ${dateFilter}
       ORDER BY a.class_date DESC, s.roll_no`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { myClasses, classRoster, upsertResult, markAttendance, classAttendance };
