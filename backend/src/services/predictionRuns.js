const pool = require("../config/db");
const { predictForMany } = require("./predictionService");

// Admin batch re-prediction: one prediction_runs row per run, processed in the background
// in chunks of 1000 students, with done/failed updated after every chunk.

const CHUNK = 1000;

async function studentIdsForScope(scope, scopeId) {
  if (scope === "all") {
    const { rows } = await pool.query("SELECT student_id FROM students ORDER BY student_id");
    return rows.map((r) => r.student_id);
  }
  if (scope === "department") {
    const dep = await pool.query("SELECT 1 FROM departments WHERE department_id = $1", [scopeId]);
    if (dep.rows.length === 0) throw Object.assign(new Error("Department not found"), { status: 404 });
    const { rows } = await pool.query(
      "SELECT student_id FROM students WHERE department_id = $1 ORDER BY student_id",
      [scopeId]
    );
    return rows.map((r) => r.student_id);
  }
  if (scope === "class") {
    const cls = await pool.query("SELECT 1 FROM faculty_courses WHERE faculty_course_id = $1", [scopeId]);
    if (cls.rows.length === 0) throw Object.assign(new Error("Class not found"), { status: 404 });
    const { rows } = await pool.query(
      `SELECT DISTINCT student_id FROM enrollments
       WHERE faculty_course_id = $1 AND status = 'enrolled' ORDER BY student_id`,
      [scopeId]
    );
    return rows.map((r) => r.student_id);
  }
  throw Object.assign(new Error(`Unknown scope: ${scope}`), { status: 400 });
}

async function processRun(runId, studentIds) {
  let done = 0;
  let failed = 0;
  let lastError = null;
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const chunk = studentIds.slice(i, i + CHUNK);
    try {
      const r = await predictForMany(chunk, { runId, trigger: "admin_run" });
      done += r.done;
      failed += r.failed;
    } catch (err) {
      console.error(`Prediction run ${runId}: chunk at ${i} failed:`, err);
      failed += chunk.length;
      lastError = err.message;
    }
    await pool.query("UPDATE prediction_runs SET done = $2, failed = $3, error = $4 WHERE id = $1", [
      runId, done, failed, lastError,
    ]);
  }
  const status = done === 0 && studentIds.length > 0 ? "failed" : "completed";
  await pool.query("UPDATE prediction_runs SET status = $2, finished_at = NOW() WHERE id = $1", [runId, status]);
}

/** Creates the run row and starts processing in the background. Returns the run row immediately. */
async function startRun({ scope, scopeId, startedBy }) {
  const running = await pool.query("SELECT id FROM prediction_runs WHERE status IN ('queued', 'running') LIMIT 1");
  if (running.rows.length > 0) {
    throw Object.assign(new Error(`Prediction run ${running.rows[0].id} is still in progress`), { status: 409 });
  }
  const studentIds = await studentIdsForScope(scope, scopeId);
  const { rows } = await pool.query(
    `INSERT INTO prediction_runs (scope, scope_id, total, status, started_by)
     VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
    [scope, scope === "all" ? null : scopeId, studentIds.length, startedBy]
  );
  const run = rows[0];
  setImmediate(() =>
    processRun(run.id, studentIds).catch(async (err) => {
      console.error(`Prediction run ${run.id} crashed:`, err);
      await pool
        .query("UPDATE prediction_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1", [run.id, err.message])
        .catch(() => {});
    })
  );
  return run;
}

async function getRun(id) {
  const { rows } = await pool.query("SELECT * FROM prediction_runs WHERE id = $1", [id]);
  return rows[0] || null;
}

/** Runs are processed in memory, so any run still "running" at startup was interrupted. */
async function markInterruptedRuns() {
  await pool.query(
    `UPDATE prediction_runs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = NOW()
     WHERE status IN ('queued', 'running')`
  );
}

module.exports = { startRun, getRun, markInterruptedRuns };
