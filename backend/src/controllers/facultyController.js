const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { MARK_FIELDS, deriveGrade } = require("../services/grading");
const { predictForStudent, predictForMany } = require("../services/predictionService");

/** Re-predict after a save. Prediction problems are logged and never fail the save
 *  (returns null on failure). */
async function repredictSafely(what, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Re-prediction after ${what} failed:`, err);
    return null;
  }
}

// Latest prediction for s.student_id, via the students.latest_prediction_id pointer
const LATEST_PREDICTION_JOIN = `LEFT JOIN LATERAL (
         SELECT p.final_label, p.reasons, p.policy_reason, p.created_at,
                (p.features->>'CGPA')::numeric AS projected_cgpa
         FROM predictions p WHERE p.prediction_id = s.latest_prediction_id
       ) lp ON TRUE`;

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
              COUNT(e.enrollment_id)::int AS enrolled_count,
              COUNT(*) FILTER (WHERE lp.final_label = 'Safe')::int AS safe,
              COUNT(*) FILTER (WHERE lp.final_label = 'At-Risk')::int AS at_risk,
              COUNT(*) FILTER (WHERE lp.final_label = 'Dropout-Likely')::int AS dropout_likely
       FROM faculty_courses fc
       JOIN courses c ON c.course_id = fc.course_id
       LEFT JOIN enrollments e ON e.faculty_course_id = fc.faculty_course_id AND e.status = 'enrolled'
       LEFT JOIN students s ON s.student_id = e.student_id
       ${LATEST_PREDICTION_JOIN}
       WHERE fc.faculty_id = $1
       GROUP BY fc.faculty_course_id, c.course_code, c.title
       ORDER BY fc.academic_year DESC, fc.semester DESC, c.course_code, fc.section`,
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
              cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks, cr.grade,
              lp.final_label, lp.reasons, lp.policy_reason, lp.projected_cgpa,
              lp.created_at AS last_predicted_at,
              att.present, att.sessions,
              ROUND(100.0 * att.present / NULLIF(att.sessions, 0), 1) AS attendance_pct
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE a.status = 'present')::int AS present, COUNT(*)::int AS sessions
         FROM attendance a WHERE a.enrollment_id = e.enrollment_id
       ) att ON TRUE
       ${LATEST_PREDICTION_JOIN}
       WHERE e.faculty_course_id = $1 AND e.status <> 'dropped'
       ORDER BY s.roll_no`,
      [fcId]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** GET /api/faculty/classes/:facultyCourseId/risk-summary
 *  Risk counts (latest final_label), grade distribution A-F and attendance % per session date. */
async function classRiskSummary(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const fcId = Number(req.params.facultyCourseId);
    await assertOwnsClass(facultyId, fcId);

    const [counts, grades, sessions] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE lp.final_label = 'Safe')::int AS safe,
                COUNT(*) FILTER (WHERE lp.final_label = 'At-Risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE lp.final_label = 'Dropout-Likely')::int AS dropout_likely,
                COUNT(*) FILTER (WHERE lp.final_label IS NULL)::int AS no_prediction
         FROM enrollments e
         JOIN students s ON s.student_id = e.student_id
         ${LATEST_PREDICTION_JOIN}
         WHERE e.faculty_course_id = $1 AND e.status = 'enrolled'`,
        [fcId]
      ),
      pool.query(
        `SELECT cr.grade, COUNT(*)::int AS count
         FROM enrollments e JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
         WHERE e.faculty_course_id = $1 AND e.status = 'enrolled' AND cr.grade IS NOT NULL
         GROUP BY cr.grade`,
        [fcId]
      ),
      pool.query(
        `SELECT a.class_date AS date,
                COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
                COUNT(*)::int AS total,
                ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'present') / COUNT(*), 1) AS attendance_pct
         FROM attendance a JOIN enrollments e ON e.enrollment_id = a.enrollment_id
         WHERE e.faculty_course_id = $1 AND e.status = 'enrolled'
         GROUP BY a.class_date ORDER BY a.class_date`,
        [fcId]
      ),
    ]);

    const byGrade = Object.fromEntries(grades.rows.map((r) => [r.grade, r.count]));
    res.json({
      counts: counts.rows[0],
      gradeDistribution: ["A", "B", "C", "D", "F"].map((g) => ({ grade: g, count: byGrade[g] || 0 })),
      attendanceBySession: sessions.rows.map((r) => ({ ...r, attendance_pct: Number(r.attendance_pct) })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** PUT /api/faculty/results/:enrollmentId - enter/update a result (upsert)
 *  Returns the saved row (server-derived grade) and the student's new prediction:
 *  { ...result, prediction: { old_label, new_label, changed, reasons } | null } */
async function upsertResult(req, res) {
  try {
    const facultyId = await getMyFacultyId(req.user.userId);
    const enrollmentId = Number(req.params.enrollmentId);

    // Verify this enrollment belongs to one of this faculty's classes
    const own = await pool.query(
      `SELECT e.enrollment_id, e.student_id FROM enrollments e
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
    const before = await pool.query(
      `SELECT p.final_label FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
       WHERE s.student_id = $1`,
      [own.rows[0].student_id]
    );
    const oldLabel = before.rows[0]?.final_label || null;
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
    const predicted = await repredictSafely("result save", () =>
      predictForStudent(own.rows[0].student_id, { trigger: "faculty_result" })
    );
    res.json({
      ...rows[0],
      prediction: predicted && {
        old_label: oldLabel,
        new_label: predicted.final_label,
        changed: oldLabel !== predicted.final_label,
        reasons: predicted.reasons,
        projected_cgpa: predicted.features?.CGPA ?? null,
        created_at: predicted.created_at,
      },
    });
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

    // Every entry must be an enrollment in this class; otherwise write nothing.
    const ids = [...new Set(entries.map((e) => e.enrollmentId))];
    const inClass = await pool.query(
      "SELECT enrollment_id, status FROM enrollments WHERE enrollment_id = ANY($1) AND faculty_course_id = $2",
      [ids, facultyCourseId]
    );
    if (inClass.rows.length !== ids.length) {
      const ok = new Set(inClass.rows.map((r) => r.enrollment_id));
      const bad = ids.filter((id) => !ok.has(id));
      return res.status(403).json({ error: `Enrollment(s) ${bad.join(", ")} are not in this class` });
    }
    const dropped = inClass.rows.filter((r) => r.status === "dropped").map((r) => r.enrollment_id);
    if (dropped.length) {
      return res.status(400).json({ error: `Enrollment(s) ${dropped.join(", ")} have dropped this course` });
    }

    const client = await pool.connect();
    const results = [];
    try {
      await client.query("BEGIN");
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
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    await logAction(req.user.userId, "MARK_ATTENDANCE", "attendance", null, { facultyCourseId, classDate, count: entries.length });
    await repredictSafely("attendance save", async () => {
      const { rows } = await pool.query(
        `SELECT DISTINCT student_id FROM enrollments WHERE enrollment_id = ANY($1) AND faculty_course_id = $2`,
        [entries.map((e) => e.enrollmentId), facultyCourseId]
      );
      await predictForMany(rows.map((r) => r.student_id), { trigger: "faculty_attendance" });
    });
    res.json(results);
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
       WHERE e.faculty_course_id = $1 AND e.status <> 'dropped' ${dateFilter}
       ORDER BY a.class_date DESC, s.roll_no`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { myClasses, classRoster, classRiskSummary, upsertResult, markAttendance, classAttendance };
