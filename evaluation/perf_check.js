// Performance check at 50k students against the RUNNING services (backend :5000, ML :8001), over
// HTTP like the browser. Each measurement runs N times (default 10); median and p90 go to
// docs/PERFORMANCE.md. Everything it writes is undone after each timing (refresh / batch
// predictions are deleted and every student's latest-prediction pointer is put back; chat messages
// are deleted), so the demo data stays as it was.
//
//   cd backend; node ../evaluation/perf_check.js [--runs 10] [--batch-runs 10]
//
// Login rate limit: needs LOGIN_RATE_LIMIT_MAX >= 30 in backend/.env (the local .env has 200).
const path = require("path");
const fs = require("fs");
const os = require("os");
const { performance } = require("perf_hooks");
const BACKEND = path.join(__dirname, "..", "backend");
require(path.join(BACKEND, "node_modules", "dotenv")).config({ path: path.join(BACKEND, ".env") });
const { Pool } = require(path.join(BACKEND, "node_modules", "pg"));

const API = process.env.PERF_API || "http://127.0.0.1:5000/api";
const ML = (process.env.ML_SERVICE_URL || "http://localhost:8001/predict").replace(/\/predict\/?$/, "");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const RUNS = arg("--runs", 10);
const BATCH_RUNS = arg("--batch-runs", RUNS);
const OUT = path.join(__dirname, "..", "docs", "PERFORMANCE.md");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STUDENT = { email: "student100040@smartedu.edu", password: "Student@123", portal: "student", roll: "BU-100040" };
const ADMIN = { email: "admin@smartedu.edu", password: "Admin@123", portal: "admin" };

async function http(method, url, { token, body } = {}) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  return { ms, json: text ? JSON.parse(text) : null };
}

const login = async (u) => (await http("POST", `${API}/auth/login`, { body: u })).json.token;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, median, p90: pct(s, 90), min: s[0], max: s[s.length - 1] };
}

async function measure(label, fn, runs = RUNS, { warmup = true } = {}) {
  if (warmup) await fn(); // one untimed call (connection pools, caches)
  const times = [];
  for (let i = 0; i < runs; i++) times.push(await fn(i));
  const st = stats(times);
  console.log(`${label.padEnd(44)} median ${fmt(st.median).padStart(9)}  p90 ${fmt(st.p90).padStart(9)}  (n=${st.n})`);
  return { label, ...st };
}
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`);

async function main() {
  const started = new Date();
  const { rows: [counts] } = await pool.query(
    "SELECT (SELECT COUNT(*) FROM students)::int AS students, (SELECT COUNT(*) FROM predictions)::int AS predictions"
  );
  console.log(`Performance check: ${counts.students} students, ${RUNS} runs each (${BATCH_RUNS} full batch runs)\n`);
  const results = [];
  const studentId = (await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [STUDENT.roll])).rows[0].student_id;

  // ---- login (bcrypt cost 10 by design) ----
  results.push(await measure("Login (student portal)", async () => (await http("POST", `${API}/auth/login`, { body: STUDENT })).ms));
  const st = await login(STUDENT);
  const ad = await login(ADMIN);

  // ---- dashboards and lists ----
  results.push(await measure("Student dashboard (GET /student/dashboard)", async () => (await http("GET", `${API}/student/dashboard`, { token: st })).ms));
  results.push(await measure("Admin dashboard (GET /admin/dashboard)", async () => (await http("GET", `${API}/admin/dashboard`, { token: ad })).ms));
  results.push(await measure("At-risk list, page 1 (25 rows)", async () => (await http("GET", `${API}/admin/at-risk-students?page=1&limit=25`, { token: ad })).ms));
  results.push(
    await measure("At-risk list, filtered (AI, Dropout-Likely, search)", async () =>
      (await http("GET", `${API}/admin/at-risk-students?page=1&limit=25&department=4&label=Dropout-Likely&search=BU-1`, { token: ad })).ms
    )
  );

  // ---- single-student refresh (writes a prediction; undone) ----
  const pointer = (await pool.query("SELECT latest_prediction_id FROM students WHERE student_id = $1", [studentId])).rows[0].latest_prediction_id;
  const tRefresh = new Date();
  results.push(await measure("Single-student refresh (POST /prediction/refresh)", async () => (await http("POST", `${API}/student/prediction/refresh`, { token: st })).ms));
  await pool.query("UPDATE students SET latest_prediction_id = $2 WHERE student_id = $1", [studentId, pointer]);
  await pool.query("DELETE FROM predictions WHERE student_id = $1 AND created_at >= $2 AND triggered_by = 'student_refresh'", [studentId, tRefresh]);

  // ---- ML service alone (NFR1.2: one prediction < 100 ms) ----
  const { rows: [feat] } = await pool.query("SELECT features FROM predictions WHERE prediction_id = $1", [pointer]);
  results.push(await measure("ML service alone: one /predict (with SHAP)", async () => (await http("POST", `${ML}/predict`, { body: { features: feat.features } })).ms));

  // ---- chat (Layer 1; Layer 2 only if enabled and the intent is unknown) ----
  const tChat = new Date();
  const questions = ["Why is my status this?", "What are my marks?", "Is my attendance OK?", "How can I improve?", "What is my CGPA?"];
  results.push(
    await measure("Chat answer (POST /student/chat, Layer 1)", async (i = 0) =>
      (await http("POST", `${API}/student/chat`, { token: st, body: { message: questions[i % questions.length] } })).ms
    )
  );
  await pool.query("DELETE FROM chat_messages WHERE student_id = $1 AND created_at >= $2", [studentId, tChat]);

  // ---- full batch prediction run (all students through the ML service; undone after each run) ----
  const snapshot = (await pool.query("SELECT student_id, latest_prediction_id FROM students")).rows;
  const batchWall = [];
  const batchServer = [];
  const fallbacks = [];
  for (let i = 0; i < BATCH_RUNS; i++) {
    const t0 = performance.now();
    const { json: run } = await http("POST", `${API}/admin/predictions/run`, { token: ad, body: { scope: "all" } });
    let r;
    for (;;) {
      await new Promise((res) => setTimeout(res, 1000));
      r = (await http("GET", `${API}/admin/predictions/runs/${run.id}`, { token: ad })).json;
      if (r.status !== "running" && r.status !== "queued") break;
    }
    const wall = performance.now() - t0;
    if (r.status !== "completed" || r.failed) throw new Error(`run ${run.id}: ${r.status}, failed ${r.failed}, ${r.error}`);
    const { rows: [srv] } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS ms,
              (SELECT COUNT(*) FILTER (WHERE source <> 'model') FROM predictions WHERE run_id = $1)::int AS fallback
       FROM prediction_runs WHERE id = $1`,
      [run.id]
    );
    batchWall.push(wall);
    batchServer.push(Number(srv.ms));
    fallbacks.push(srv.fallback);
    console.log(`  batch run ${i + 1}/${BATCH_RUNS}: ${r.done} students, ${fmt(Number(srv.ms))} (server), ${srv.fallback} fallback`);
    // undo: pointers back, this run's rows gone, space reusable
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `UPDATE students s SET latest_prediction_id = v.p FROM unnest($1::int[], $2::int[]) AS v(id, p) WHERE s.student_id = v.id`,
        [snapshot.map((x) => x.student_id), snapshot.map((x) => x.latest_prediction_id)]
      );
      await c.query("DELETE FROM predictions WHERE run_id = $1", [run.id]);
      await c.query("DELETE FROM prediction_runs WHERE id = $1", [run.id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    await pool.query("VACUUM predictions");
  }
  const bs = stats(batchServer);
  const bw = stats(batchWall);
  results.push({ label: `Full batch prediction run (${counts.students} students), server time`, ...bs });
  results.push({ label: "Full batch prediction run, wall time incl. polling", ...bw });

  const { rows: [after] } = await pool.query("SELECT (SELECT COUNT(*) FROM predictions)::int AS predictions");
  const env = {
    date: `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, "0")}-${String(started.getDate()).padStart(2, "0")}`, // local date
    cpu: `${os.cpus()[0].model.trim()} (${os.cpus().length} logical cores)`,
    ram: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    pg: (await pool.query("SHOW server_version")).rows[0].server_version,
    llm: process.env.CHAT_LLM_ENABLED === "true" ? `on (${process.env.CHAT_LLM_PROVIDER})` : "off",
  };
  writeReport({ results, counts, env, fallbacks, after });
  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}; predictions table back to ${after.predictions} rows (was ${counts.predictions}).`);
  await pool.end();
}

function writeReport({ results, counts, env, fallbacks, after }) {
  const row = (r) => `| ${r.label} | ${r.n} | ${fmt(r.median)} | ${fmt(r.p90)} | ${fmt(r.min)} | ${fmt(r.max)} |`;
  const get = (prefix) => results.find((r) => r.label.startsWith(prefix));
  const batch = get("Full batch prediction run (");
  const per100k = (batch.median / counts.students) * 100000;
  const lines = [
    "# Performance at 50k students",
    "",
    `Measured on ${env.date} by \`evaluation/perf_check.js\` (\`cd backend; node ../evaluation/perf_check.js\`) against the running`,
    "services over HTTP on one machine (backend :5000, ML service :8001, PostgreSQL), after `npm run demo:reset`.",
    `Each row: ${results[0].n} timed runs after one untimed warm-up (the batch run: ${batch.n} runs, no warm-up). Times are`,
    "end-to-end request times seen by the client (localhost, so no network latency).",
    "",
    `Machine: ${env.cpu}, ${env.ram} RAM, ${env.os}; Node ${env.node}; PostgreSQL ${env.pg}. Data: ${counts.students} students,`,
    `${counts.predictions} stored predictions. Chat Layer 2 (LLM): ${env.llm}.`,
    "",
    "| Operation | Runs | Median | p90 | Min | Max |",
    "|---|---|---|---|---|---|",
    ...results.map(row),
    "",
    `Every batch run scored all ${counts.students} students through the Random Forest service (fallback rows per run:`,
    `${fallbacks.join(", ")}). Each timing's writes were undone afterwards (the predictions table is back to ${after.predictions} rows).`,
    "",
    "## Against the SRS non-functional targets",
    "",
    "| Target | Measured | Verdict |",
    "|---|---|---|",
    `| NFR1.1: 100,000+ records in under 5 minutes | ${fmt(batch.median)} median for ${counts.students} students, about ${fmt(per100k)} per 100,000 extrapolated linearly | ${per100k < 300000 ? "met (extrapolated)" : "not met"} |`,
    `| NFR1.2: one prediction under 100 ms | ML service alone ${fmt(get("ML service alone").median)} median (p90 ${fmt(get("ML service alone").p90)}); the full refresh request incl. feature building, policy and the database write ${fmt(get("Single-student refresh").median)} | ${get("ML service alone").median < 100 ? "met" : "not met"} for the model call |`,
    `| NFR1.3: dashboard under 3 seconds | student ${fmt(get("Student dashboard").median)}, admin ${fmt(get("Admin dashboard").median)} (API time; the browser adds rendering) | ${Math.max(get("Student dashboard").p90, get("Admin dashboard").p90) < 3000 ? "met" : "not met"} |`,
    "",
    "Notes",
    "",
    "- Login is deliberately slow-ish: bcrypt cost 10 (about 60-100 ms per check) plus the profile lookup.",
    "- The batch run processes 1,000 students per chunk and the ML service scores up to 2,000 rows per call; SHAP",
    "  explanations dominate its time. The extrapolation to 100,000 assumes linear scaling, which the chunked design gives.",
    "- One machine, one user at a time: this is not a load test (NFR4.2, 50 concurrent users, was not measured).",
    "",
  ];
  fs.writeFileSync(OUT, lines.join("\n"));
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
