const pool = require("../config/db");
const config = require("../config/academicStanding.json");

// Academic standing (Phase 7) under the BU Student Handbook (Spring 2024), clause 5.5. Every number
// (minimum CGPA per programme, probations before drop) comes from config/academicStanding.json.
// Standing is separate from the ML risk label and never changes it.
//
//   1.1.25 / 5.5.1  below the programme minimum at the end of a semester -> probation
//                   (first semester: GPA; later semesters: CGPA)
//   5.5.3 / 1.1.8   below the minimum again in the semester right after two consecutive probations -> dropped
//   5.5.4           at or above the minimum -> off probation, count back to 0

const STATUSES = ["good", "probation_1", "probation_2", "dropped", "not_evaluated"];
const LABELS = {
  good: "Good standing",
  probation_1: "Probation 1 of 2",
  probation_2: "Probation 2 of 2",
  dropped: "Dropped",
  not_evaluated: "Not evaluated yet",
};

/** The student's programme from their department code (students have no programme column). */
function programmeFor(departmentCode) {
  return config.department_programme[departmentCode] || config.default_programme;
}

/** Minimum CGPA for a programme (BS 2.0, MS 2.5, PhD 3.0, ...). */
function minimumFor(programme = config.default_programme) {
  const m = config.min_cgpa[programme];
  if (m === undefined) throw new Error(`No minimum CGPA configured for programme "${programme}"`);
  return m;
}

/** Number of semesters in a programme (BS 8, MS 4, ...; config programme_length, to be confirmed by the department). */
function lengthFor(programme = config.default_programme) {
  const n = config.programme_length[programme];
  if (n === undefined) throw new Error(`No length configured for programme "${programme}"`);
  return n;
}

/** The figure a semester is judged on: GPA for the first semester (if configured), CGPA after that. */
function gradeUsed(semesterNo, gpa, cgpa) {
  return semesterNo === 1 && config.first_semester_uses_gpa ? gpa : cgpa;
}

const round2 = (v) => Math.round(Number(v) * 100) / 100;

/**
 * nextStanding(previousStatus, previousCount, cgpa, semesterNo, {programme}) -> {status, count}
 * Pure. `semesterNo` is the semester that has just been completed (null / 0 = no completed term yet);
 * `cgpa` is the figure for that semester (see gradeUsed).
 */
function nextStanding(previousStatus, previousCount, cgpa, semesterNo, { programme = config.default_programme } = {}) {
  const count = Number(previousCount) || 0;
  if (previousStatus === "dropped") return { status: "dropped", count };
  if (!semesterNo || cgpa === null || cgpa === undefined || Number.isNaN(Number(cgpa))) {
    return { status: "not_evaluated", count };
  }
  if (round2(cgpa) >= minimumFor(programme)) return { status: "good", count: 0 };
  if (count >= config.probations_before_drop) return { status: "dropped", count };
  const next = count + 1;
  return { status: `probation_${next}`, count: next };
}

/**
 * Starting status for demo:reset (source 'seed'; the dataset has one completed term per student):
 * current semester 1 -> not_evaluated; CGPA at or above the minimum -> good; below and the dataset's
 * consecutive-low-CGPA flag set -> probation_2; below otherwise -> probation_1.
 */
function seedStatus({ semester, cgpa, consecutiveLow, programme = config.default_programme }) {
  if (!semester || semester <= 1 || cgpa === null || cgpa === undefined) return { status: "not_evaluated", count: 0 };
  if (round2(cgpa) >= minimumFor(programme)) return { status: "good", count: 0 };
  return consecutiveLow ? { status: "probation_2", count: 2 } : { status: "probation_1", count: 1 };
}

/**
 * recordStanding(db, {studentId, closeId, semesterNo, cgpaUsed, status, count, source, finalSemesterCompleted}) -> standing id.
 * Inserts the row and moves students.academic_status / probation_count with it (same transaction).
 * finalSemesterCompleted (migration 016): the close ended the last semester of the student's programme.
 */
async function recordStanding(db, { studentId, closeId = null, semesterNo = null, cgpaUsed = null, status, count, source, finalSemesterCompleted = false }) {
  const { rows } = await db.query(
    `INSERT INTO academic_standing (student_id, close_id, semester_no, cgpa_used, status, probation_count, source, final_semester_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [studentId, closeId, semesterNo, cgpaUsed, status, count, source, finalSemesterCompleted]
  );
  await db.query("UPDATE students SET academic_status = $2, probation_count = $3 WHERE student_id = $1", [studentId, status, count]);
  return rows[0].id;
}

/**
 * seedStandings(db) -> counts per status. Gives every student without a standing row their starting
 * status (seedStatus), from their latest imported semester record. Rows go in student_id order, so
 * the ids are the same on every reset. Seeded students get no warning letters.
 */
async function seedStandings(db = pool) {
  const { rows } = await db.query(
    `SELECT s.student_id, d.code AS department, sp.semester, sp.cgpa, sp.consecutive_low_cgpa
     FROM students s
     JOIN departments d ON d.department_id = s.department_id
     LEFT JOIN LATERAL (
       SELECT semester, cgpa, consecutive_low_cgpa FROM student_semester_performance
       WHERE student_id = s.student_id ORDER BY semester DESC, performance_id DESC LIMIT 1
     ) sp ON TRUE
     WHERE NOT EXISTS (SELECT 1 FROM academic_standing a WHERE a.student_id = s.student_id)
     ORDER BY s.student_id`
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const cols = { id: [], sem: [], cgpa: [], status: [], count: [] };
  for (const r of rows) {
    const cgpa = r.cgpa === null ? null : Number(r.cgpa);
    const st = seedStatus({ semester: r.semester, cgpa, consecutiveLow: Number(r.consecutive_low_cgpa) > 0, programme: programmeFor(r.department) });
    counts[st.status] += 1;
    cols.id.push(r.student_id);
    cols.sem.push(r.semester);
    cols.cgpa.push(st.status === "not_evaluated" ? null : cgpa);
    cols.status.push(st.status);
    cols.count.push(st.count);
  }
  const CHUNK = 10000;
  for (let i = 0; i < cols.id.length; i += CHUNK) {
    const part = (a) => a.slice(i, i + CHUNK);
    await db.query(
      `INSERT INTO academic_standing (student_id, semester_no, cgpa_used, status, probation_count, source)
       SELECT sid, sem, cgpa, st, cnt, 'seed'
       FROM unnest($1::int[], $2::int[], $3::numeric[], $4::text[], $5::int[]) WITH ORDINALITY AS t(sid, sem, cgpa, st, cnt, ord)
       ORDER BY ord`,
      [part(cols.id), part(cols.sem), part(cols.cgpa), part(cols.status), part(cols.count)]
    );
  }
  await db.query(
    `UPDATE students s SET academic_status = a.status, probation_count = a.probation_count
     FROM academic_standing a WHERE a.student_id = s.student_id AND a.source = 'seed'
       AND NOT EXISTS (SELECT 1 FROM academic_standing b WHERE b.student_id = a.student_id AND b.id > a.id)`
  );
  return counts;
}

/** The student's latest standing row (with its letter and approval, if any), or null. */
async function latestStanding(studentId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.*, sc.term_label FROM academic_standing a LEFT JOIN semester_closes sc ON sc.id = a.close_id
     WHERE a.student_id = $1 ORDER BY a.id DESC LIMIT 1`,
    [studentId]
  );
  return rows[0] || null;
}

module.exports = {
  config,
  STATUSES,
  LABELS,
  programmeFor,
  minimumFor,
  lengthFor,
  gradeUsed,
  nextStanding,
  seedStatus,
  recordStanding,
  seedStandings,
  latestStanding,
};
