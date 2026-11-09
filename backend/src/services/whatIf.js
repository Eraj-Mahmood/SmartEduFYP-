const pool = require("../config/db");
const { buildFeatures, SGPA_SLOPE, SGPA_INTERCEPT } = require("./featureBuilder");
const { scoreWithoutSaving } = require("./predictionService");

// What-if simulator (staff only, nothing is saved): the student's real 20 features, with some of
// this term's numbers overridden, scored by the same pipeline as a stored prediction
// (ML /predict/batch -> escalate-only policy -> staff reasons). Never inserts a predictions row.

const OVERRIDABLE = ["Attendance_Percentage", "Assignment_Avg", "Quiz_Avg", "Midterm_Marks", "Final_Marks"];
const MARKS = ["Assignment_Avg", "Quiz_Avg", "Midterm_Marks", "Final_Marks"];
// what the simulator shows before/after (the overridable inputs plus what they move)
const SHOWN = [...OVERRIDABLE, "SGPA", "CGPA", "Previous_SGPA"];

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Checks {overrides}: only OVERRIDABLE keys, numbers 0-100 (empty/null values ignored). -> clean object (400 otherwise). */
function parseOverrides(body) {
  const o = body && body.overrides;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw httpError(400, "overrides must be an object");
  const unknown = Object.keys(o).filter((k) => !OVERRIDABLE.includes(k));
  if (unknown.length) throw httpError(400, `Unknown override(s): ${unknown.join(", ")}. Allowed: ${OVERRIDABLE.join(", ")}`);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === "" || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw httpError(400, `${k} must be a number from 0 to 100`);
    out[k] = n;
  }
  return out; // may be empty: the UI's first call, which returns today's inputs as the baseline
}

/**
 * applyOverrides(features, overrides) -> new features. When any mark changes, provisional SGPA is
 * recomputed from the mean of the four marks (the Phase 1 scale, clamp(0.0640 x mean - 2.453, 0, 4))
 * and projected CGPA = (Previous_SGPA + SGPA) / 2, as featureBuilder does. Pure.
 */
function applyOverrides(features, overrides) {
  const f = { ...features, ...overrides };
  if (MARKS.some((k) => k in overrides)) {
    const mean = MARKS.reduce((n, k) => n + Number(f[k]), 0) / MARKS.length;
    f.SGPA = round2(clamp(SGPA_SLOPE * mean + SGPA_INTERCEPT, 0, 4));
    f.CGPA = round2((Number(f.Previous_SGPA) + f.SGPA) / 2);
  }
  return f;
}

/** 403 unless the faculty member teaches the student this term (enrolled) or is their active counselor. */
async function assertFacultyCanSee(facultyId, studentId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM enrollments e JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
     WHERE e.student_id = $1 AND fc.faculty_id = $2 AND e.status = 'enrolled'
     UNION ALL
     SELECT 1 FROM counselor_assignments ca WHERE ca.student_id = $1 AND ca.faculty_id = $2 AND ca.status = 'active'
     LIMIT 1`,
    [studentId, facultyId]
  );
  if (!rows.length) throw httpError(403, "This student is not in your classes or your counselees");
}

const pick = (f) => Object.fromEntries(SHOWN.map((k) => [k, f[k] == null ? null : Number(f[k])]));
const publicResult = (r) => ({
  model_label: r.model_label,
  policy_label: r.policy_label,
  final_label: r.final_label,
  policy_reason: r.policy_reason,
  source: r.source,
  model_version: r.model_version,
  drivers: r.drivers, // staff only: SHAP drivers (feature, value, shap, direction)
  reasons: r.reasons,
});

/**
 * runWhatIf(studentId, overrides) -> {student, baseline, scenario, inputs: {before, after}, overrides, saved: false}
 * baseline = today's features scored now; scenario = with the overrides. One ML batch call.
 */
async function runWhatIf(studentId, overrides) {
  const { rows } = await pool.query("SELECT student_id, roll_no, full_name FROM students WHERE student_id = $1", [studentId]);
  if (!rows.length) throw httpError(404, "Student not found");
  const built = await buildFeatures(studentId);
  if (!built) throw httpError(404, "No performance history to simulate from");
  const changed = { ...built, features: applyOverrides(built.features, overrides) };
  const [baseline, scenario] = await scoreWithoutSaving([built, changed]);
  return {
    student: rows[0],
    overrides,
    inputs: { before: pick(built.features), after: pick(changed.features) },
    baseline: publicResult(baseline),
    scenario: publicResult(scenario),
    label_changed: baseline.final_label !== scenario.final_label,
    saved: false,
  };
}

module.exports = { runWhatIf, parseOverrides, applyOverrides, assertFacultyCanSee, OVERRIDABLE };
