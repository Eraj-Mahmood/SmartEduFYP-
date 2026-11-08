const pool = require("../config/db");
const { sendError } = require("../middleware/errors");
const { runWhatIf, parseOverrides, assertFacultyCanSee } = require("../services/whatIf");

// Model transparency (Phase 5): the admin Model page and the staff what-if simulator.

/** The ML service's /model-info URL, derived from ML_SERVICE_URL (.../predict) unless ML_INFO_URL is set. */
const ML_INFO_URL = () => process.env.ML_INFO_URL || String(process.env.ML_SERVICE_URL || "").replace(/\/predict\/?$/, "") + "/model-info";

// Shown on the Model page's limitations box. The benchmark figure comes from the training notebook
// (an early-warning variant of the evaluation), not from the .pkl metadata.
const LIMITATIONS = {
  early_warning_benchmark_macro_f1: 0.934,
  notes: [
    "Trained and evaluated on a synthetic dataset (50,000 generated students), not real institutional records.",
    "Labels are policy-derived: the dataset's Safe / At-Risk / Dropout-Likely labels were generated from rules, so the very high test scores mostly show the model learned those rules.",
    "On the early-warning benchmark (notebook) the macro F1 is 0.934 - a more realistic expectation than the 0.999 test score.",
    "The policy layer can only escalate a label; it never lowers what the model says.",
    "Probabilities are not shown to students; predictions are an early warning, not a decision.",
  ],
};

async function fetchModelInfo() {
  try {
    const res = await fetch(ML_INFO_URL(), { signal: AbortSignal.timeout(60000) }); // first call may compute importance (~10 s)
    if (!res.ok) throw new Error(`ML service responded ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("ML /model-info unavailable:", err.message);
    return null;
  }
}

/**
 * GET /api/admin/model -> {ml_online, model (ML /model-info or null), stats, limitations}
 * stats are over each student's LATEST prediction (students.latest_prediction_id):
 *   source share (model | fallback), model_label vs policy_label agreement (3x3 matrix),
 *   escalations (final_label more severe than model_label), final label distribution, last run.
 */
async function modelOverview(req, res) {
  try {
    const [model, bySource, pairs, labels, lastRun] = await Promise.all([
      fetchModelInfo(),
      pool.query(
        `SELECT p.source, COUNT(*)::int AS n FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
         GROUP BY p.source ORDER BY n DESC`
      ),
      pool.query(
        `SELECT p.model_label, p.policy_label, p.final_label, COUNT(*)::int AS n
         FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
         WHERE p.source = 'model'
         GROUP BY p.model_label, p.policy_label, p.final_label`
      ),
      pool.query(
        `SELECT p.final_label, COUNT(*)::int AS n FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
         GROUP BY p.final_label`
      ),
      pool.query(
        `SELECT id, scope, scope_id, total, done, failed, status, started_at, finished_at,
                EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS duration_seconds
         FROM prediction_runs ORDER BY started_at DESC LIMIT 1`
      ),
    ]);

    const total = bySource.rows.reduce((n, r) => n + r.n, 0);
    const modelRows = pairs.rows.reduce((n, r) => n + r.n, 0);
    const agree = pairs.rows.filter((r) => r.model_label === r.policy_label).reduce((n, r) => n + r.n, 0);
    const escalated = pairs.rows.filter((r) => r.final_label !== r.model_label).reduce((n, r) => n + r.n, 0);
    const LABELS = ["Safe", "At-Risk", "Dropout-Likely"];
    const matrix = LABELS.map((m) => LABELS.map((p) => pairs.rows.filter((r) => r.model_label === m && r.policy_label === p).reduce((n, r) => n + r.n, 0)));
    const escalations = {};
    for (const r of pairs.rows) if (r.final_label !== r.model_label) escalations[`${r.model_label} -> ${r.final_label}`] = (escalations[`${r.model_label} -> ${r.final_label}`] || 0) + r.n;

    res.json({
      ml_online: !!model,
      model,
      stats: {
        students_with_prediction: total,
        source: Object.fromEntries(bySource.rows.map((r) => [r.source, r.n])),
        agreement: {
          compared: modelRows, // model-sourced predictions only (fallback rows have no model label of their own)
          agree,
          rate: modelRows ? agree / modelRows : null,
          labels: LABELS,
          matrix, // rows: model_label, columns: policy_label
        },
        escalated: { count: escalated, rate: modelRows ? escalated / modelRows : null, by_change: escalations },
        label_distribution: Object.fromEntries(LABELS.map((l) => [l, (labels.rows.find((r) => r.final_label === l) || { n: 0 }).n])),
        last_run: lastRun.rows[0] || null,
      },
      limitations: LIMITATIONS,
    });
  } catch (err) {
    sendError(res, err, "Could not load the model information");
  }
}

/** POST /api/faculty/students/:id/what-if {overrides} - own class students or active counselees only. */
async function facultyWhatIf(req, res) {
  try {
    const studentId = Number(req.params.studentId);
    const overrides = parseOverrides(req.body);
    const { rows } = await pool.query("SELECT faculty_id FROM faculty WHERE user_id = $1", [req.user.userId]);
    if (!rows.length) return res.status(403).json({ error: "Faculty profile not found" });
    await assertFacultyCanSee(rows[0].faculty_id, studentId);
    res.json(await runWhatIf(studentId, overrides));
  } catch (err) {
    sendError(res, err, "Could not run the what-if simulation");
  }
}

/** POST /api/admin/students/:id/what-if {overrides} - any student. */
async function adminWhatIf(req, res) {
  try {
    res.json(await runWhatIf(Number(req.params.studentId), parseOverrides(req.body)));
  } catch (err) {
    sendError(res, err, "Could not run the what-if simulation");
  }
}

module.exports = { modelOverview, facultyWhatIf, adminWhatIf, ML_INFO_URL, LIMITATIONS };
