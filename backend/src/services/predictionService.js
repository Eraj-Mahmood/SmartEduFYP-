const pool = require("../config/db");
const { buildFeatures, buildFeaturesMany } = require("./featureBuilder");
const { applyPolicy } = require("./policy");
const { toReasons } = require("./reasons");

// One prediction = build features from live data -> ML service (SHAP drivers) or rule
// fallback -> policy layer (escalate only) -> plain-language reasons -> predictions row.
// predicted_label is kept for compatibility and always equals final_label.

const ML_URL = () => process.env.ML_SERVICE_URL;                                  // .../predict
const ML_BATCH_URL = () => process.env.ML_BATCH_URL || `${process.env.ML_SERVICE_URL}/batch`; // .../predict/batch
const ML_BATCH_MAX = 2000;
const INSERT_CHUNK = 1000;

// Fixed probabilities for each fallback label (the rules don't produce real probabilities).
const FALLBACK_PROBS = {
  "Dropout-Likely": { prob_safe: 0.05, prob_at_risk: 0.15, prob_dropout: 0.8 },
  "At-Risk": { prob_safe: 0.2, prob_at_risk: 0.6, prob_dropout: 0.2 },
  Safe: { prob_safe: 0.85, prob_at_risk: 0.12, prob_dropout: 0.03 },
};

/** Transparent fallback when the ML service is down: the institutional policy rules
 *  (config/policy.json, same thresholds as the policy layer) decide the label. */
function ruleBasedFallback(features) {
  const { policyLabel } = applyPolicy(features, "Safe");
  return { label: policyLabel, ...FALLBACK_PROBS[policyLabel], model_version: "rule_fallback" };
}

async function postJson(url, body, timeoutMs) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ML service responded ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Model output for each feature set, falling back to rules when the ML service fails. */
async function scoreMany(builtList) {
  const scored = [];
  for (let i = 0; i < builtList.length; i += ML_BATCH_MAX) {
    const chunk = builtList.slice(i, i + ML_BATCH_MAX);
    try {
      const { results } = await postJson(ML_BATCH_URL(), { rows: chunk.map((b) => b.features) }, 120000);
      results.forEach((r) => scored.push({ ...r, source: "model" }));
    } catch (err) {
      console.warn("ML batch call failed, using rule-based fallback:", err.message);
      chunk.forEach((b) => scored.push({ ...ruleBasedFallback(b.features), source: "fallback" }));
    }
  }
  return scored;
}

async function scoreOne(built) {
  try {
    return { ...(await postJson(ML_URL(), { features: built.features }, 15000)), source: "model" };
  } catch (err) {
    console.warn("ML service unreachable, using rule-based fallback:", err.message);
    return { ...ruleBasedFallback(built.features), source: "fallback" };
  }
}

function toRow(studentId, built, scored, { trigger, runId }) {
  const drivers = scored.source === "model" ? scored.explanations : null;
  const policy = applyPolicy(built.features, scored.label);
  return [
    studentId, built.extra.semester, policy.finalLabel,
    scored.prob_safe, scored.prob_at_risk, scored.prob_dropout, scored.model_version || "fallback_v1",
    scored.label, policy.policyLabel, policy.finalLabel, policy.reason,
    drivers ? JSON.stringify(drivers) : null,
    JSON.stringify(toReasons(drivers, built.features, policy.finalLabel)),
    JSON.stringify(built.features), JSON.stringify(built.sources),
    scored.source, trigger || null, runId || null,
  ];
}

const COLUMNS = [
  "student_id", "semester", "predicted_label", "prob_safe", "prob_at_risk", "prob_dropout", "model_version",
  "model_label", "policy_label", "final_label", "policy_reason", "drivers", "reasons", "features",
  "feature_sources", "source", "triggered_by", "run_id",
];

/** Inserts prediction rows and moves each student's students.latest_prediction_id to the new row,
 *  one transaction per chunk. The pointer only moves forward (a newer id), so an older insert that
 *  commits late never overwrites a newer one. */
async function insertRows(rows) {
  const inserted = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const params = [];
    const values = chunk.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: out } = await client.query(
        `INSERT INTO predictions (${COLUMNS.join(", ")}) VALUES ${values.join(", ")} RETURNING *`,
        params
      );
      await client.query(
        `UPDATE students s SET latest_prediction_id = v.prediction_id
         FROM unnest($1::int[], $2::int[]) AS v(student_id, prediction_id)
         WHERE s.student_id = v.student_id
           AND (s.latest_prediction_id IS NULL OR s.latest_prediction_id < v.prediction_id)`,
        [out.map((r) => r.student_id), out.map((r) => r.prediction_id)]
      );
      await client.query("COMMIT");
      inserted.push(...out);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return inserted;
}

/**
 * predictForStudent(studentId, {trigger}) -> the inserted predictions row.
 * Throws an error with status 404 when the student has no performance history.
 */
async function predictForStudent(studentId, { trigger } = {}) {
  const built = await buildFeatures(studentId);
  if (!built) {
    const e = new Error("No performance history to predict from yet");
    e.status = 404;
    throw e;
  }
  const scored = await scoreOne(built);
  const [row] = await insertRows([toRow(Number(studentId), built, scored, { trigger })]);
  return row;
}

/**
 * predictForMany(studentIds, {runId, trigger}) -> {done, failed}
 * Batched end to end: 3 feature queries, one ML call per 2000 students, multi-row inserts.
 * Students without a performance row count as failed.
 */
async function predictForMany(studentIds, { runId, trigger } = {}) {
  const ids = [...new Set(studentIds.map(Number))];
  if (ids.length === 0) return { done: 0, failed: 0 };
  const builtMap = await buildFeaturesMany(ids);
  const withData = ids.filter((id) => builtMap.has(id));
  const builtList = withData.map((id) => builtMap.get(id));
  const scored = await scoreMany(builtList);
  const rows = withData.map((id, i) => toRow(id, builtList[i], scored[i], { trigger, runId }));
  await insertRows(rows);
  return { done: rows.length, failed: ids.length - rows.length };
}

module.exports = { predictForStudent, predictForMany, ruleBasedFallback };
