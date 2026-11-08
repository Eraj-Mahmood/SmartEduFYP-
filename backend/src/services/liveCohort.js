const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { logAction } = require("../middleware/audit");
const { parseCsv, toCsv, parseNumber, httpError } = require("./csv");

// Live cohort import (admin, Phase 5 / Objective 7): real classroom students who are not in the
// database yet. One CSV row per student creates a user (random password, must change it), a
// student (data_source 'live', the institution's actual_outcome if given), an enrollment in a live
// class section and a student_semester_performance row (data_source 'live', target_label NULL).
// Values the file doesn't have stay NULL: the ML pipeline's imputers fill them (median /
// most frequent of the training data), and the report lists them. Column guide:
// docs/LIVE_DATA_TEMPLATE.md.

const REQUIRED = [
  "roll_no", "full_name", "department", "semester", "cgpa", "previous_sgpa", "attendance",
  "assignment", "quiz", "midterm", "final", "failed_courses", "credits",
];
const OPTIONAL = ["actual_outcome", "gender", "age", "study_hours", "lms_logins", "submission_rate", "scholarship", "hostel"];
// model features with no column of their own, and what the import does about them
const DERIVED = {
  SGPA: "2 x CGPA - Previous_SGPA (dataset identity CGPA = (Previous_SGPA + SGPA) / 2), clamped to 0-4",
  Credits_Passed: "credits - 3 x failed_courses (dataset identity), at least 0",
};
// model feature <- CSV column (numbers: [min, max, integer?])
const NUMERIC = {
  semester: ["Semester", 1, 12, true],
  cgpa: ["CGPA", 0, 4],
  previous_sgpa: ["Previous_SGPA", 0, 4],
  attendance: ["Attendance_Percentage", 0, 100],
  assignment: ["Assignment_Avg", 0, 100],
  quiz: ["Quiz_Avg", 0, 100],
  midterm: ["Midterm_Marks", 0, 100],
  final: ["Final_Marks", 0, 100],
  failed_courses: ["Failed_Courses", 0, 30, true],
  credits: ["Credits_Enrolled", 1, 40, true],
  age: ["Age", 14, 80, true],
  study_hours: ["Study_Hours_Per_Week", 0, 100],
  lms_logins: ["LMS_Login_Count", 0, 10000, true],
  submission_rate: ["Assignment_Submission_Rate", 0, 100],
};
const OUTCOMES = { safe: "safe", at_risk: "at_risk", "at-risk": "at_risk", dropout: "dropout", "dropout-likely": "dropout", dropout_likely: "dropout", unknown: "unknown" };
const YES_NO = { yes: "Yes", y: "Yes", no: "No", n: "No" };
const GENDERS = { male: "Male", m: "Male", female: "Female", f: "Female" };
const PREVIEW_ROWS = 20;
const ROLL_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,29}$/;

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Validates the rows. -> [{row, roll_no, name, values, missing, errors}] */
async function validateCohort(records) {
  const { rows: depts } = await pool.query("SELECT department_id, code, name FROM departments");
  const deptBy = new Map();
  for (const d of depts) {
    deptBy.set(d.code.toLowerCase(), d);
    deptBy.set(d.name.toLowerCase(), d);
  }
  const rolls = records.map((r) => String(r.data.roll_no || "").trim().toUpperCase()).filter(Boolean);
  const { rows: taken } = await pool.query("SELECT roll_no FROM students WHERE UPPER(roll_no) = ANY($1)", [rolls]);
  const exists = new Set(taken.map((t) => t.roll_no.toUpperCase()));
  const seen = new Map();

  return records.map((rec) => {
    const d = rec.data;
    const errors = [];
    const missing = [];
    const err = (column, message) => errors.push({ column, message });
    const roll = String(d.roll_no || "").trim().toUpperCase();
    if (!roll) err("roll_no", "Roll number is empty");
    else if (!ROLL_RE.test(roll)) err("roll_no", `Roll number "${d.roll_no}" may only use letters, digits and dashes (3-30 characters)`);
    else if (exists.has(roll)) err("roll_no", `${roll} already exists in SmartEdu`);
    else if (seen.has(roll)) err("roll_no", `${roll} appears twice in this file (first on row ${seen.get(roll)})`);
    else seen.set(roll, rec.row);

    const name = String(d.full_name || "").trim();
    if (!name) err("full_name", "Full name is empty");
    else if (name.length > 150) err("full_name", "Full name is longer than 150 characters");

    const dept = deptBy.get(String(d.department || "").trim().toLowerCase());
    if (!dept) err("department", `Unknown department "${d.department || ""}" (use one of: ${depts.map((x) => x.code).join(", ")})`);

    const values = {};
    for (const [col, [feature, lo, hi, int]] of Object.entries(NUMERIC)) {
      if (!(col in d) && !REQUIRED.includes(col)) continue; // optional column not in the file
      const v = parseNumber(d[col], lo, hi);
      if (Number.isNaN(v) || (int && v !== null && !Number.isInteger(v))) {
        err(col, `${col} must be ${int ? "a whole number" : "a number"} from ${lo} to ${hi} (got "${d[col]}")`);
      } else {
        values[feature] = v;
        if (v === null) missing.push(feature);
      }
    }
    if (values.Semester == null && !errors.some((e) => e.column === "semester")) err("semester", "Semester is required");

    let outcome = null;
    if (d.actual_outcome !== undefined && String(d.actual_outcome).trim() !== "") {
      outcome = OUTCOMES[String(d.actual_outcome).trim().toLowerCase().replace(/\s+/g, "_")];
      if (!outcome) err("actual_outcome", `actual_outcome must be safe, at_risk, dropout or unknown (got "${d.actual_outcome}")`);
    }
    const pick = (col, map, feature) => {
      if (d[col] === undefined || String(d[col]).trim() === "") {
        missing.push(feature);
        return null;
      }
      const v = map[String(d[col]).trim().toLowerCase()];
      if (!v) err(col, `${col} must be ${[...new Set(Object.values(map))].join(" or ")} (got "${d[col]}")`);
      return v || null;
    };
    const gender = pick("gender", GENDERS, "Gender");
    const scholarship = pick("scholarship", YES_NO, "Scholarship");
    const hostel = pick("hostel", YES_NO, "Hostel");
    for (const col of ["age", "study_hours", "lms_logins", "submission_rate"]) if (!(col in d)) missing.push(NUMERIC[col][0]);

    // derived with the dataset identities (documented in docs/LIVE_DATA_TEMPLATE.md)
    const sgpa = values.CGPA != null && values.Previous_SGPA != null ? round2(clamp(2 * values.CGPA - values.Previous_SGPA, 0, 4)) : null;
    const passed = values.Credits_Enrolled != null && values.Failed_Courses != null ? Math.max(0, values.Credits_Enrolled - 3 * values.Failed_Courses) : null;
    if (sgpa === null) missing.push("SGPA");
    if (passed === null) missing.push("Credits_Passed");

    return {
      row: rec.row,
      roll_no: roll,
      name,
      department: dept || null,
      values: { ...values, SGPA: sgpa, Credits_Passed: passed },
      gender, scholarship, hostel, outcome,
      missing: [...new Set(missing)],
      errors,
    };
  });
}

/** The class section the cohort joins (created if needed). */
async function liveSection(db, { courseId, facultyId, section, semester, academicYear, userId }) {
  const found = await db.query(
    "SELECT faculty_course_id FROM faculty_courses WHERE faculty_id = $1 AND course_id = $2 AND section = $3 AND semester = $4 AND academic_year = $5",
    [facultyId, courseId, section, semester, academicYear]
  );
  if (found.rows.length) return { id: found.rows[0].faculty_course_id, created: false };
  const { rows } = await db.query(
    `INSERT INTO faculty_courses (faculty_id, course_id, section, semester, academic_year, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING faculty_course_id`,
    [facultyId, courseId, section, semester, academicYear, userId]
  );
  return { id: rows[0].faculty_course_id, created: true };
}

/** Checks the course / faculty / section settings. -> {course, faculty, section, semester, academicYear} */
async function cohortSettings(body) {
  const courseId = parseInt(body.courseId);
  const facultyId = parseInt(body.facultyId);
  const section = String(body.section || "LIVE").trim().toUpperCase();
  if (!(courseId > 0) || !(facultyId > 0)) throw httpError(400, "Choose the course and the faculty member who teaches the live class");
  if (!/^[A-Z0-9-]{1,10}$/.test(section)) throw httpError(400, "Section: 1-10 letters, digits or dashes (e.g. LIVE)");
  const [c, f, y] = await Promise.all([
    pool.query(
      `SELECT c.course_id, c.course_code, c.title,
              (SELECT fc.semester FROM faculty_courses fc WHERE fc.course_id = c.course_id ORDER BY fc.academic_year DESC LIMIT 1) AS semester
       FROM courses c WHERE c.course_id = $1`,
      [courseId]
    ),
    pool.query("SELECT faculty_id, full_name FROM faculty WHERE faculty_id = $1", [facultyId]),
    pool.query("SELECT academic_year FROM faculty_courses ORDER BY academic_year DESC LIMIT 1"),
  ]);
  if (!c.rows.length) throw httpError(400, "Unknown course");
  if (!f.rows.length) throw httpError(400, "Unknown faculty member");
  const academicYear = String(body.academicYear || (y.rows[0] && y.rows[0].academic_year) || "2025-2026");
  if (!/^\d{4}-\d{4}$/.test(academicYear)) throw httpError(400, "academicYear must look like 2025-2026");
  // the section's semester: as given, else the semester this course is usually taught in
  const semester = parseInt(body.semester) || c.rows[0].semester || 1;
  return { course: c.rows[0], faculty: f.rows[0], section, semester, academicYear };
}

/**
 * importCohort({mode, file, body, userId}) -> {summary, errors, missing_features, preview, upload, class}
 * preview validates only (logged as 'previewed'); commit writes every valid row in one transaction.
 */
async function importCohort({ mode, file, body, userId }) {
  if (!["preview", "commit"].includes(mode)) throw httpError(400, "mode must be preview or commit");
  const settings = await cohortSettings(body);
  const { records } = parseCsv(file.buffer, { required: REQUIRED });
  const rows = await validateCohort(records);
  const good = rows.filter((r) => !r.errors.length);
  const errors = rows.flatMap((r) => r.errors.map((e) => ({ row: r.row, roll_no: r.roll_no || null, ...e })));
  const summary = { rows_total: rows.length, rows_ok: good.length, rows_failed: rows.length - good.length, rows_skipped: 0 };
  // which model inputs are missing, and for how many valid students (the imputer fills them)
  const missingCounts = {};
  for (const r of good) for (const m of r.missing) missingCounts[m] = (missingCounts[m] || 0) + 1;
  const report = {
    missing_features: Object.entries(missingCounts).map(([feature, students]) => ({ feature, students })).sort((a, b) => b.students - a.students),
    derived: DERIVED,
    with_outcome: good.filter((r) => r.outcome && r.outcome !== "unknown").length,
  };
  const preview = rows.slice(0, PREVIEW_ROWS).map((r) => ({
    row: r.row, roll_no: r.roll_no, name: r.name, department: r.department && r.department.code,
    semester: r.values.Semester, cgpa: r.values.CGPA, attendance: r.values.Attendance_Percentage,
    actual_outcome: r.outcome, missing: r.missing, ok: !r.errors.length, errors: r.errors,
  }));
  const filename = String(file.originalname || "cohort.csv").slice(0, 255);
  const meta = { ...report, class: { course: settings.course.course_code, faculty: settings.faculty.full_name, section: settings.section, semester: settings.semester, academic_year: settings.academicYear } };

  if (mode === "preview" || !good.length) {
    const { rows: [upload] } = await pool.query(
      `INSERT INTO uploads (uploaded_by, kind, filename, rows_total, rows_ok, rows_failed, errors, summary, status)
       VALUES ($1, 'cohort', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, filename, summary.rows_total, mode === "preview" ? summary.rows_ok : 0, summary.rows_failed, JSON.stringify(errors.slice(0, 500)), JSON.stringify(meta), mode === "preview" ? "previewed" : "failed"]
    );
    return { mode, summary, errors, ...report, preview, upload, class: meta.class };
  }

  // passwords: random, never shown; the account must set its own via an admin-issued reset
  const hashes = await Promise.all(good.map(() => bcrypt.hash(crypto.randomBytes(18).toString("base64url"), 10)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const section = await liveSection(client, { courseId: settings.course.course_id, facultyId: settings.faculty.faculty_id, section: settings.section, semester: settings.semester, academicYear: settings.academicYear, userId });
    const { rows: [upload] } = await client.query(
      `INSERT INTO uploads (faculty_course_id, uploaded_by, kind, filename, rows_total, rows_ok, rows_failed, errors, summary, status, committed_at)
       VALUES ($1, $2, 'cohort', $3, $4, $5, $6, $7, $8, 'committed', NOW()) RETURNING *`,
      [section.id, userId, filename, summary.rows_total, summary.rows_ok, summary.rows_failed, JSON.stringify(errors.slice(0, 500)), JSON.stringify({ ...meta, class_created: section.created })]
    );
    const studentIds = [];
    for (let i = 0; i < good.length; i++) {
      const r = good[i];
      const v = r.values;
      const email = `live.${r.roll_no.toLowerCase()}@smartedu.edu`;
      const { rows: [u] } = await client.query(
        "INSERT INTO users (email, password_hash, role, must_reset_pw) VALUES ($1, $2, 'student', TRUE) RETURNING user_id",
        [email, hashes[i]]
      );
      const { rows: [s] } = await client.query(
        `INSERT INTO students (user_id, roll_no, full_name, department_id, gender, age, current_semester, cgpa, scholarship, hostel, data_source, actual_outcome)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live', $11) RETURNING student_id`,
        [u.user_id, r.roll_no, r.name, r.department.department_id, r.gender, v.Age ?? null, v.Semester, v.CGPA, r.scholarship, r.hostel, r.outcome]
      );
      await client.query("INSERT INTO enrollments (student_id, faculty_course_id, status, enrolled_by) VALUES ($1, $2, 'enrolled', $3)", [s.student_id, section.id, userId]);
      await client.query(
        `INSERT INTO student_semester_performance
           (student_id, semester, attendance_percentage, assignment_avg, quiz_avg, midterm_marks, final_marks,
            study_hours_per_week, lms_login_count, assignment_submission_rate, previous_sgpa, sgpa, cgpa,
            consecutive_low_cgpa, failed_courses, credits_enrolled, credits_passed, warning_count, target_label,
            data_source, upload_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NULL, NULL, 'live', $18)`,
        [
          s.student_id, v.Semester, v.Attendance_Percentage, v.Assignment_Avg, v.Quiz_Avg, v.Midterm_Marks, v.Final_Marks,
          v.Study_Hours_Per_Week ?? null, v.LMS_Login_Count ?? null, v.Assignment_Submission_Rate ?? null, v.Previous_SGPA, v.SGPA, v.CGPA,
          v.CGPA != null && v.Previous_SGPA != null ? Number(v.CGPA < 2 && v.Previous_SGPA < 2) : null,
          v.Failed_Courses, v.Credits_Enrolled, v.Credits_Passed, upload.id,
        ]
      );
      studentIds.push(s.student_id);
    }
    await client.query("COMMIT");
    return { mode, summary, errors, ...report, preview, upload, class: { ...meta.class, faculty_course_id: section.id, created: section.created }, student_ids: studentIds };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * removeCohort(uploadId) -> {students, class_removed}. Undoes a committed cohort import: deletes the
 * students it created (their users; enrollments, marks, attendance, predictions and chat cascade)
 * and, if the import created the class section and it is now empty, the section and its uploads.
 * For tests and demo resets (backend/src/scripts/removeLiveCohort.js); the audit log is kept.
 * audit {actorUserId (or null), via}: also writes a REMOVE_LIVE_COHORT audit entry (the script does).
 */
async function removeCohort(uploadId, { audit } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [up] } = await client.query("SELECT * FROM uploads WHERE id = $1 AND kind = 'cohort'", [uploadId]);
    if (!up) throw httpError(404, `No cohort upload #${uploadId}`);
    const { rows: users } = await client.query(
      `SELECT DISTINCT s.user_id FROM student_semester_performance sp JOIN students s ON s.student_id = sp.student_id
       WHERE sp.upload_id = $1 AND s.data_source = 'live'`,
      [uploadId]
    );
    await client.query("DELETE FROM users WHERE user_id = ANY($1)", [users.map((u) => u.user_id)]);
    let classRemoved = false;
    if (up.faculty_course_id && up.summary && up.summary.class_created) {
      const left = await client.query("SELECT 1 FROM enrollments WHERE faculty_course_id = $1 LIMIT 1", [up.faculty_course_id]);
      if (!left.rows.length) {
        await client.query("DELETE FROM uploads WHERE faculty_course_id = $1", [up.faculty_course_id]);
        await client.query("DELETE FROM faculty_courses WHERE faculty_course_id = $1", [up.faculty_course_id]);
        classRemoved = true;
      }
    }
    await client.query("DELETE FROM uploads WHERE id = $1", [uploadId]);
    await client.query("COMMIT");
    if (audit) {
      await logAction(audit.actorUserId ?? null, "REMOVE_LIVE_COHORT", "uploads", Number(uploadId), {
        filename: up.filename,
        students: users.length,
        faculty_course_id: up.faculty_course_id,
        class: up.summary && up.summary.class,
        class_removed: classRemoved,
        via: audit.via || null,
      });
    }
    return { students: users.length, class_removed: classRemoved };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** The empty template (header only). */
const cohortTemplate = () => toCsv([...REQUIRED, ...OPTIONAL], []);

module.exports = { importCohort, removeCohort, validateCohort, cohortTemplate, REQUIRED, OPTIONAL, DERIVED, ROLL_RE };
