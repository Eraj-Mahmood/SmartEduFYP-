const pool = require("../config/db");
const { MARK_FIELDS, deriveGrade } = require("./grading");
const { predictForMany } = require("./predictionService");
const { parseCsv, toCsv, todayLocal, isIsoDate, parseNumber, httpError } = require("./csv");

// Faculty bulk uploads (FR13): results or attendance for ONE class from a CSV file.
//   preview -> validate every row, return a summary + the first 20 parsed rows; no marks or
//              attendance are written (the request is logged in `uploads` as 'previewed')
//   commit  -> write the good rows in one transaction (data_source = 'live', upload_id), derive
//              grades, upsert on existing keys, re-predict the affected students (trigger 'upload')
// Bad rows are rejected one by one with {row, column, message} (NFR7); good rows are still saved.

const KINDS = {
  results: { required: ["roll_no", ...MARK_FIELDS], audit: "UPLOAD_RESULTS" },
  attendance: { required: ["roll_no", "class_date", "status"], audit: "UPLOAD_ATTENDANCE" },
};
const STATUSES = ["present", "absent", "leave"]; // attendance_status enum (schema.sql)
const PREVIEW_ROWS = 20;
const MAX_STORED_ERRORS = 500;
const normRoll = (r) => String(r || "").trim().toUpperCase();

/** The class's enrollments by roll number (dropped ones too, to say why they're rejected). */
async function classRoster(facultyCourseId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.enrollment_id, e.student_id, e.status, s.roll_no, s.full_name
     FROM enrollments e JOIN students s ON s.student_id = e.student_id
     WHERE e.faculty_course_id = $1 ORDER BY s.roll_no`,
    [facultyCourseId]
  );
  return rows;
}

/** Common row check: roll number present, enrolled in this class and not dropped. */
function checkRoll(rec, byRoll, errors) {
  const roll = normRoll(rec.data.roll_no);
  if (!roll) {
    errors.push({ column: "roll_no", message: "Roll number is empty" });
    return null;
  }
  const enr = byRoll.get(roll);
  if (!enr) {
    errors.push({ column: "roll_no", message: `${roll} is not enrolled in this class` });
    return null;
  }
  if (enr.status === "dropped") {
    errors.push({ column: "roll_no", message: `${roll} has dropped this course` });
    return null;
  }
  return enr;
}

/** -> [{row, roll_no, name, values, enrollment, errors, skipped}] for a results file. */
function validateResults(records, byRoll) {
  const seen = new Map();
  return records.map((rec) => {
    const errors = [];
    const values = {};
    for (const f of MARK_FIELDS) {
      const n = parseNumber(rec.data[f]);
      if (Number.isNaN(n)) errors.push({ column: f, message: `${f} must be a number from 0 to 100 (got "${rec.data[f]}")` });
      else values[f] = n;
    }
    const blank = MARK_FIELDS.every((f) => values[f] === null);
    const enr = checkRoll(rec, byRoll, errors);
    const roll = normRoll(rec.data.roll_no);
    if (roll && !blank) {
      if (seen.has(roll)) errors.push({ column: "roll_no", message: `${roll} appears twice in this file (first on row ${seen.get(roll)})` });
      else seen.set(roll, rec.row);
    }
    // a template row left empty (no marks at all) is skipped, not an error - unless the roll no is bad
    const skipped = blank && !!enr;
    return { row: rec.row, roll_no: roll, name: enr ? enr.full_name : rec.data.name || null, values, enrollment: enr, errors: skipped ? [] : errors, skipped };
  });
}

/** -> rows for an attendance file. Dates must be real and not in the future; one row per (roll, date). */
function validateAttendance(records, byRoll, today = todayLocal()) {
  const seen = new Map();
  return records.map((rec) => {
    const errors = [];
    const date = String(rec.data.class_date || "").trim();
    const status = String(rec.data.status || "").trim().toLowerCase();
    const blank = !status;
    if (!isIsoDate(date)) errors.push({ column: "class_date", message: `class_date must be a real date written YYYY-MM-DD (got "${date}")` });
    else if (date > today) errors.push({ column: "class_date", message: `class_date ${date} is in the future` });
    if (!blank && !STATUSES.includes(status)) errors.push({ column: "status", message: `status must be present, absent or leave (got "${rec.data.status}")` });
    const enr = checkRoll(rec, byRoll, errors);
    const roll = normRoll(rec.data.roll_no);
    const key = `${roll}|${date}`;
    if (roll && !blank && isIsoDate(date)) {
      if (seen.has(key)) errors.push({ column: "class_date", message: `${roll} already has a row for ${date} in this file (row ${seen.get(key)})` });
      else seen.set(key, rec.row);
    }
    // a template row with no status is skipped (nothing to save) when its roll number is fine
    const skipped = blank && !!enr;
    return { row: rec.row, roll_no: roll, name: enr ? enr.full_name : rec.data.name || null, values: { class_date: date, status }, enrollment: enr, errors: skipped ? [] : errors, skipped };
  });
}

/** The error list stored and returned: one entry per problem, with the row and roll number. */
const flatErrors = (rows) => rows.flatMap((r) => r.errors.map((e) => ({ row: r.row, roll_no: r.roll_no || null, ...e })));

const previewRow = (r) => ({
  row: r.row,
  roll_no: r.roll_no,
  name: r.name,
  ...r.values,
  ok: !r.errors.length && !r.skipped,
  skipped: r.skipped,
  errors: r.errors,
});

/** Latest final_label per student id. */
async function latestLabels(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT s.student_id, p.final_label FROM students s LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     WHERE s.student_id = ANY($1)`,
    [ids]
  );
  return new Map(rows.map((r) => [r.student_id, r.final_label]));
}

/** Writes the good rows in one transaction and logs the upload. -> uploads row */
async function commitRows(kind, { facultyCourseId, userId, filename }, good, counts, errors) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [upload] } = await client.query(
      `INSERT INTO uploads (faculty_course_id, uploaded_by, kind, filename, rows_total, rows_ok, rows_failed, errors, summary, status, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'committed', NOW()) RETURNING *`,
      [facultyCourseId, userId, kind, filename, counts.total, good.length, counts.failed, JSON.stringify(errors.slice(0, MAX_STORED_ERRORS)), JSON.stringify({ rows_skipped: counts.skipped })]
    );
    if (kind === "results") {
      const ids = good.map((r) => r.enrollment.enrollment_id);
      const { rows: existing } = await client.query(
        `SELECT enrollment_id, ${MARK_FIELDS.join(", ")} FROM course_results WHERE enrollment_id = ANY($1)`,
        [ids]
      );
      const byId = new Map(existing.map((e) => [e.enrollment_id, e]));
      for (const r of good) {
        const old = byId.get(r.enrollment.enrollment_id) || {};
        // an empty cell keeps the saved mark (0 for a new result), like the single-row save
        const marks = Object.fromEntries(MARK_FIELDS.map((f) => [f, r.values[f] ?? (old[f] != null ? Number(old[f]) : 0)]));
        await client.query(
          `INSERT INTO course_results (enrollment_id, assignment_avg, quiz_avg, midterm_marks, final_marks, grade, updated_by, updated_at, data_source, upload_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'live', $8)
           ON CONFLICT (enrollment_id) DO UPDATE
             SET assignment_avg = EXCLUDED.assignment_avg, quiz_avg = EXCLUDED.quiz_avg,
                 midterm_marks = EXCLUDED.midterm_marks, final_marks = EXCLUDED.final_marks,
                 grade = EXCLUDED.grade, updated_by = EXCLUDED.updated_by, updated_at = NOW(),
                 data_source = 'live', upload_id = EXCLUDED.upload_id`,
          [r.enrollment.enrollment_id, marks.assignment_avg, marks.quiz_avg, marks.midterm_marks, marks.final_marks, deriveGrade(marks), userId, upload.id]
        );
      }
    } else {
      for (const r of good) {
        await client.query(
          `INSERT INTO attendance (enrollment_id, class_date, status, marked_by, marked_at, data_source, upload_id)
           VALUES ($1, $2, $3, $4, NOW(), 'live', $5)
           ON CONFLICT (enrollment_id, class_date) DO UPDATE
             SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by, marked_at = NOW(),
                 data_source = 'live', upload_id = EXCLUDED.upload_id`,
          [r.enrollment.enrollment_id, r.values.class_date, r.values.status, userId, upload.id]
        );
      }
    }
    await client.query("COMMIT");
    return upload;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * processClassUpload({facultyCourseId, userId, kind, mode, file: {buffer, originalname}})
 * -> {upload, mode, kind, summary, errors, preview, repredicted, labels_changed}
 * The caller has already checked the class belongs to the user.
 */
async function processClassUpload({ facultyCourseId, userId, kind, mode, file }) {
  if (!KINDS[kind]) throw httpError(400, "kind must be results or attendance");
  if (!["preview", "commit"].includes(mode)) throw httpError(400, "mode must be preview or commit");
  const { records } = parseCsv(file.buffer, { required: KINDS[kind].required });
  const roster = await classRoster(facultyCourseId);
  const byRoll = new Map(roster.map((r) => [normRoll(r.roll_no), r]));
  const rows = kind === "results" ? validateResults(records, byRoll) : validateAttendance(records, byRoll);

  const good = rows.filter((r) => !r.errors.length && !r.skipped);
  const errors = flatErrors(rows);
  const counts = { total: rows.length, ok: good.length, failed: rows.filter((r) => r.errors.length).length, skipped: rows.filter((r) => r.skipped).length };
  const summary = { rows_total: counts.total, rows_ok: counts.ok, rows_failed: counts.failed, rows_skipped: counts.skipped };
  const filename = String(file.originalname || "upload.csv").slice(0, 255);
  const out = { mode, kind, summary, errors, preview: rows.slice(0, PREVIEW_ROWS).map(previewRow) };

  if (mode === "preview" || !good.length) {
    const status = mode === "preview" ? "previewed" : "failed";
    const { rows: [upload] } = await pool.query(
      `INSERT INTO uploads (faculty_course_id, uploaded_by, kind, filename, rows_total, rows_ok, rows_failed, errors, summary, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [facultyCourseId, userId, kind, filename, counts.total, mode === "preview" ? counts.ok : 0, counts.failed, JSON.stringify(errors.slice(0, MAX_STORED_ERRORS)), JSON.stringify({ rows_skipped: counts.skipped }), status]
    );
    return { ...out, upload, repredicted: 0, labels_changed: [] };
  }

  const studentIds = [...new Set(good.map((r) => r.enrollment.student_id))];
  const before = await latestLabels(studentIds);
  const upload = await commitRows(kind, { facultyCourseId, userId, filename }, good, counts, errors);

  // re-predict the affected students; a prediction problem never undoes the saved rows
  let repredicted = 0;
  let labelsChanged = [];
  try {
    const r = await predictForMany(studentIds, { trigger: "upload" });
    repredicted = r.done;
    const after = await latestLabels(studentIds);
    const names = new Map(good.map((g) => [g.enrollment.student_id, g]));
    labelsChanged = studentIds
      .filter((id) => after.get(id) && before.get(id) !== after.get(id))
      .map((id) => ({ student_id: id, roll_no: names.get(id).roll_no, name: names.get(id).name, old_label: before.get(id) || null, new_label: after.get(id) }));
  } catch (err) {
    console.error("Re-prediction after upload failed:", err.message);
  }
  const { rows: [updated] } = await pool.query(
    "UPDATE uploads SET summary = summary || $2::jsonb WHERE id = $1 RETURNING *",
    [upload.id, JSON.stringify({ students: studentIds.length, repredicted, labels_changed: labelsChanged.length })]
  );
  return { ...out, upload: updated, repredicted, labels_changed: labelsChanged };
}

/** Template CSV for a class: header + one row per enrolled student (roll_no, name), values empty. */
async function classTemplate(facultyCourseId, kind) {
  const roster = (await classRoster(facultyCourseId)).filter((r) => r.status !== "dropped");
  if (kind === "results") {
    return toCsv(["roll_no", "name", ...MARK_FIELDS], roster.map((r) => [r.roll_no, r.full_name, "", "", "", ""]));
  }
  if (kind === "attendance") {
    const today = todayLocal();
    return toCsv(["roll_no", "name", "class_date", "status"], roster.map((r) => [r.roll_no, r.full_name, today, ""]));
  }
  throw httpError(404, "Unknown template");
}

module.exports = { processClassUpload, classTemplate, validateResults, validateAttendance, KINDS, STATUSES, PREVIEW_ROWS };
