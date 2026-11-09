// Usage: cd backend; npm run demo:reset [-- --yes] [-- --as-of YYYY-MM-DD] [-- --seed N]
//
// Rebuilds the demo database from the repo alone, deterministically:
//   drop + create the database in DATABASE_URL -> schema.sql -> every migration -> the 50k CSV
//   (import_dataset.py) -> faculty / courses / enrollments / marks / attendance (seed_demo_data.py)
//   -> student names (generate_student_names.py) -> admin account (createAdmin.js) -> tutorials
//   (seedTutorials.js --no-check) -> the SYNTHETIC live cohort (evaluation/sample_live_cohort.csv as
//   CS301 section LIVE, Dr. Amina Sheikh) -> one full prediction run through the REAL ML service
//   (strict: no rule fallback) -> summary + fingerprint.
//
// Needs: PostgreSQL running, the ML service running (checked BEFORE anything is dropped), and a
// Python with database/requirements.txt (system `python`, or set PYTHON=<path>).
// Same --seed and --as-of (the date of the latest class session, default today) -> identical data;
// the fingerprint at the end hashes every table except timestamps, password hashes and audit_log.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..", "..", "..");
const BACKEND = path.join(ROOT, "backend");
const DATASET = path.join(ROOT, "SmartEdu_Synthetic_Dataset_V2_50000_Sheet_.csv");
const COHORT_CSV = path.join(ROOT, "evaluation", "sample_live_cohort.csv");
const ADMIN = { email: "admin@smartedu.edu", password: "Admin@123" };
const COHORT = { course: "CS301", faculty: "Dr. Amina Sheikh", section: "LIVE" };
const PREDICT_CHUNK = 1000;
const FEATURE_COUNT = 20;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(msg) {
  console.error(`\nDEMO RESET FAILED: ${msg}`);
  process.exit(1);
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const startedAt = Date.now();
let stepNo = 0;
function step(title) {
  stepNo++;
  console.log(`\n[${stepNo}] ${title}  (${((Date.now() - startedAt) / 1000).toFixed(0)} s)`);
}

/** Runs a command, streaming its output; exits on failure. */
function run(cmd, cmdArgs, { cwd = BACKEND, label } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: process.env });
  if (r.error) fail(`${label || cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${label || cmd} exited with code ${r.status}`);
}

async function confirm(dbName) {
  if (flag("--yes")) return;
  if (!process.stdin.isTTY) fail("not an interactive terminal: pass --yes to confirm");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) =>
    rl.question(`This DELETES the database "${dbName}" and rebuilds the demo data. Type "yes" to continue: `, res)
  );
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Cancelled; nothing was changed.");
    process.exit(0);
  }
}

async function checkMlService() {
  const predictUrl = process.env.ML_SERVICE_URL;
  if (!predictUrl) fail("ML_SERVICE_URL is not set in backend/.env");
  const healthUrl = predictUrl.replace(/\/predict\/?$/, "") + "/health";
  let body;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    fail(`the ML service is not reachable at ${healthUrl} (${e.message}).\n` +
      "Start it first: cd ml_service; .venv\\Scripts\\python -m uvicorn app:app --port 8001\n" +
      "The reset never stores rule-fallback predictions, so it stops here. Nothing was changed.");
  }
  const n = (body.features_expected || []).length;
  if (n !== FEATURE_COUNT) fail(`the ML service lists ${n} features, expected ${FEATURE_COUNT}. Nothing was changed.`);
  console.log(`ML service OK: ${body.model} (${n} features)`);
}

function pythonCommand() {
  const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const r = spawnSync(py, ["-c", "import psycopg2, pandas, bcrypt"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    fail(`"${py}" can't import psycopg2, pandas and bcrypt.\n` +
      `Install them: ${py} -m pip install -r database/requirements.txt (or set PYTHON=<path to a python that has them>). Nothing was changed.`);
  }
  return py;
}

async function recreateDatabase(dbUrl, dbName) {
  const adminUrl = new URL(dbUrl.toString());
  adminUrl.pathname = "/postgres";
  const c = new Client({ connectionString: adminUrl.toString() });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await c.end();
  }
}

async function applySchema(dsn) {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  try {
    await c.query(fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8"));
  } finally {
    await c.end();
  }
}

async function importCohort(pool, adminUserId) {
  const { importCohort: doImport } = require("../services/liveCohort");
  const { logAction } = require("../middleware/audit");
  const { rows: [ids] } = await pool.query(
    `SELECT (SELECT course_id FROM courses WHERE course_code = $1) AS course_id,
            (SELECT faculty_id FROM faculty WHERE full_name = $2) AS faculty_id`,
    [COHORT.course, COHORT.faculty]
  );
  if (!ids.course_id || !ids.faculty_id) fail(`live cohort: ${COHORT.course} or ${COHORT.faculty} not found`);
  const out = await doImport({
    mode: "commit",
    file: { buffer: fs.readFileSync(COHORT_CSV), originalname: path.basename(COHORT_CSV) },
    body: { courseId: ids.course_id, facultyId: ids.faculty_id, section: COHORT.section },
    userId: adminUserId,
  });
  if (out.summary.rows_failed > 0 || out.summary.rows_ok === 0) {
    fail(`live cohort: ${out.summary.rows_ok} rows imported, ${out.summary.rows_failed} rejected: ${JSON.stringify(out.errors.slice(0, 3))}`);
  }
  await logAction(adminUserId, "IMPORT_LIVE_COHORT", "uploads", out.upload.id, {
    filename: out.upload.filename, status: out.upload.status, class: out.class, ...out.summary, via: "demo:reset",
  });
  console.log(`Imported ${out.summary.rows_ok} SYNTHETIC students into ${COHORT.course} ${COHORT.section} ` +
    `(class ${out.class.faculty_course_id}, upload #${out.upload.id}).`);
}

async function predictAll(pool, adminUserId) {
  const { predictForMany } = require("../services/predictionService");
  const { rows } = await pool.query("SELECT student_id FROM students ORDER BY student_id");
  const ids = rows.map((r) => r.student_id);
  const { rows: [runRow] } = await pool.query(
    `INSERT INTO prediction_runs (scope, scope_id, total, status, started_by)
     VALUES ('all', NULL, $1, 'running', $2) RETURNING id`,
    [ids.length, adminUserId]
  );
  let done = 0;
  let failed = 0;
  try {
    for (let i = 0; i < ids.length; i += PREDICT_CHUNK) {
      const r = await predictForMany(ids.slice(i, i + PREDICT_CHUNK), { runId: runRow.id, trigger: "admin_run", strict: true });
      done += r.done;
      failed += r.failed;
      await pool.query("UPDATE prediction_runs SET done = $2, failed = $3 WHERE id = $1", [runRow.id, done, failed]);
      process.stdout.write(`\r  ${done + failed} / ${ids.length} students`);
    }
  } catch (e) {
    await pool.query("UPDATE prediction_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1", [runRow.id, e.message]);
    fail(`prediction run stopped: ${e.message}\nThe database is incomplete; start the ML service and run the reset again.`);
  }
  await pool.query("UPDATE prediction_runs SET status = 'completed', finished_at = NOW() WHERE id = $1", [runRow.id]);
  console.log(`\n  run #${runRow.id}: ${done} predicted, ${failed} without performance data`);
  const { rows: [src] } = await pool.query("SELECT COUNT(*) FILTER (WHERE source <> 'model')::int AS non_model FROM predictions");
  if (src.non_model > 0) fail(`${src.non_model} predictions are not from the model`);
  if (failed > 0) fail(`${failed} students could not be predicted`);
}

/** md5 per table over every column except timestamps and password hashes, rows in primary-key order. */
async function fingerprint(pool) {
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('audit_log')
     ORDER BY table_name`
  );
  const out = {};
  for (const { table_name: t } of tables) {
    const { rows: cols } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    const keep = cols
      .filter((c) => !c.data_type.startsWith("timestamp") && c.column_name !== "password_hash")
      .map((c) => `"${c.column_name}"`);
    const { rows: pk } = await pool.query(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attnum`,
      [t]
    );
    const order = pk.length ? pk.map((p) => `"${p.attname}"`).join(", ") : keep.join(", ");
    const { rows: [h] } = await pool.query(
      `SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(r::text, E'\\n' ORDER BY ord), '')) AS md5
       FROM (SELECT ROW(${keep.join(", ")}) AS r, ROW(${order}) AS ord FROM "${t}") x`
    );
    out[t] = h;
  }
  return out;
}

async function summary(pool) {
  const fp = await fingerprint(pool);
  console.log("\nRows per table:");
  for (const [t, h] of Object.entries(fp)) console.log(`  ${t.padEnd(30)} ${String(h.n).padStart(7)}`);
  const { rows: labels } = await pool.query(
    `SELECT p.final_label, COUNT(*)::int AS n FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
     GROUP BY 1 ORDER BY 1`
  );
  console.log("\nLatest label per student (final_label):");
  for (const l of labels) console.log(`  ${l.final_label.padEnd(16)} ${String(l.n).padStart(7)}`);
  const { rows: [agree] } = await pool.query(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE model_label = policy_label)::int AS agree,
            COUNT(*) FILTER (WHERE final_label <> model_label)::int AS escalated
     FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id`
  );
  console.log(`  model = policy: ${agree.agree} / ${agree.n}; policy raised: ${agree.escalated}`);
  const { rows: standing } = await pool.query(
    `SELECT academic_status, COUNT(*)::int AS n FROM students GROUP BY 1
     ORDER BY array_position(ARRAY['good','probation_1','probation_2','dropped','not_evaluated'], academic_status)`
  );
  console.log("\nAcademic standing (BU rules) per student:");
  for (const s of standing) console.log(`  ${s.academic_status.padEnd(16)} ${String(s.n).padStart(7)}`);
  const { rows: [cons] } = await pool.query(
    `WITH g AS (
       SELECT e.student_id, AVG(CASE cr.grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 ELSE 0 END) AS pts
       FROM enrollments e JOIN course_results cr ON cr.enrollment_id = e.enrollment_id GROUP BY e.student_id),
     lp AS (SELECT DISTINCT ON (student_id) student_id, cgpa, target_label FROM student_semester_performance ORDER BY student_id, semester DESC)
     SELECT COUNT(*)::int AS enrolled,
            COUNT(*) FILTER (WHERE ABS(ROUND(g.pts, 2) - lp.cgpa) <= 0.5)::int AS grade_ok,
            COUNT(*) FILTER (WHERE ABS(ROUND(g.pts, 2) - lp.cgpa) <= 0.5 AND p.predicted_label = lp.target_label)::int AS fully
     FROM g JOIN lp ON lp.student_id = g.student_id
     JOIN students s ON s.student_id = g.student_id LEFT JOIN predictions p ON p.prediction_id = s.latest_prediction_id`
  );
  console.log(`\nStudents with course marks: ${cons.enrolled}; grades within 0.5 of CGPA: ${cons.grade_ok}; ` +
    `also model label = dataset label: ${cons.fully} (database/find_consistent_demo_students.sql)`);
  const combined = require("crypto").createHash("md5")
    .update(Object.entries(fp).map(([t, h]) => `${t}:${h.n}:${h.md5}`).join("\n")).digest("hex");
  console.log("\nFingerprint (identical for two resets with the same --seed and --as-of):");
  for (const [t, h] of Object.entries(fp)) console.log(`  ${t.padEnd(30)} ${h.md5}`);
  console.log(`  ${"ALL".padEnd(30)} ${combined}`);
}

async function main() {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) fail("DATABASE_URL is not set in backend/.env");
  const dbUrl = new URL(dsn);
  const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) fail(`unexpected database name "${dbName}"`);
  const seed = option("--seed") || "2026";
  const asOf = option("--as-of") || localDate();
  if (!/^\d+$/.test(seed)) fail("--seed must be a whole number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail("--as-of must be YYYY-MM-DD");
  for (const f of [DATASET, COHORT_CSV]) if (!fs.existsSync(f)) fail(`missing ${f}`);

  console.log(`SmartEdu demo reset: database "${dbName}" on ${dbUrl.hostname}:${dbUrl.port || 5432}, seed ${seed}, latest class date ${asOf}`);
  await checkMlService();
  const py = pythonCommand();
  await confirm(dbName);

  step(`Drop and recreate "${dbName}"`);
  await recreateDatabase(dbUrl, dbName);
  step("Schema (database/schema.sql)");
  await applySchema(dsn);
  step("Migrations");
  run(process.execPath, [path.join(__dirname, "migrate.js")], { label: "migrate" });
  step("Import the 50k-row dataset (import_dataset.py)");
  run(py, [path.join(ROOT, "database", "import_dataset.py"), "--csv", DATASET, "--dsn", dsn], { label: "import_dataset.py" });
  step("Faculty, courses, classes, enrollments, marks, attendance (seed_demo_data.py)");
  run(py, [path.join(ROOT, "database", "seed_demo_data.py"), "--dsn", dsn, "--seed", seed, "--as-of", asOf], { label: "seed_demo_data.py" });
  step("Student names (generate_student_names.py)");
  run(py, [path.join(ROOT, "database", "generate_student_names.py"), "--dsn", dsn, "--seed", seed], { label: "generate_student_names.py" });
  step("Admin account (createAdmin.js)");
  run(process.execPath, [path.join(__dirname, "createAdmin.js"), ADMIN.email, ADMIN.password], { label: "createAdmin.js" });
  step("Tutorials (seedTutorials.js --no-check)");
  run(process.execPath, [path.join(__dirname, "seedTutorials.js"), "--no-check"], { label: "seedTutorials.js" });

  const pool = require("../config/db");
  const { rows: [admin] } = await pool.query("SELECT user_id FROM users WHERE email = $1", [ADMIN.email]);
  step("Live cohort (evaluation/sample_live_cohort.csv, SYNTHETIC)");
  await importCohort(pool, admin.user_id);
  step("Academic standing (seeded starting status, BU Handbook 5.5; config/academicStanding.json)");
  const standing = await require("../services/academicStanding").seedStandings(pool);
  console.log("  " + Object.entries(standing).map(([k, v]) => `${k} ${v}`).join(" · "));
  step("Predict every student through the ML service (strict, no fallback)");
  await predictAll(pool, admin.user_id);
  step("Summary");
  await summary(pool);
  console.log(`\nDemo reset finished in ${((Date.now() - startedAt) / 1000).toFixed(0)} s. ` +
    `Logins: ${ADMIN.email} / ${ADMIN.password}, faculty Faculty@123, students Student@123 (docs/DEMO_ACCOUNTS.md).`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
