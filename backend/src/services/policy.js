const config = require("../config/policy.json");

// Institutional policy layer. Rules and thresholds live in config/policy.json
// (recovered from the dataset by evaluation/policy_tree.py). The policy can only
// escalate the model's label: final label = the more severe of model and policy.

const SEVERITY = { Safe: 0, "At-Risk": 1, "Dropout-Likely": 2 };
const T = config.thresholds;

// Rule conditions, keyed by the rule ids in policy.json. "consecutive_low_cgpa" is computed
// from CGPA and Previous_SGPA (exactly how the dataset defines Consecutive_Low_CGPA) so it
// reacts to live/projected values instead of the imported flag.
const CONDITIONS = {
  consecutive_low_cgpa: (f) => f.CGPA < T.probation_cgpa && f.Previous_SGPA < T.probation_cgpa,
  severe_absence: (f) => f.Attendance_Percentage < T.severe_attendance_pct,
  low_cgpa: (f) => f.CGPA < T.at_risk_cgpa,
  low_attendance: (f) => f.Attendance_Percentage < T.min_attendance_pct,
};

const fmt = {
  CGPA: (v) => Number(v).toFixed(2),
  Previous_SGPA: (v) => Number(v).toFixed(2),
  Attendance_Percentage: (v) => String(Math.round(Number(v) * 10) / 10),
};

function fillTemplate(template, features) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (key in T) return key.endsWith("_cgpa") ? Number(T[key]).toFixed(2) : String(T[key]);
    if (key in features) return fmt[key] ? fmt[key](features[key]) : String(features[key]);
    return `{${key}}`;
  });
}

function moreSevere(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/**
 * applyPolicy(features, modelLabel) -> {policyLabel, reason, finalLabel, escalated}
 * policyLabel is the most severe label of any rule that fired ("Safe" if none).
 * reason explains the rules that set policyLabel (null if none fired).
 */
function applyPolicy(features, modelLabel) {
  const fired = config.rules.filter((r) => CONDITIONS[r.id] && CONDITIONS[r.id](features));
  const policyLabel = fired.reduce((label, r) => moreSevere(label, r.label), "Safe");
  const decisive = fired.filter((r) => r.label === policyLabel);
  const reason = decisive.length ? decisive.map((r) => fillTemplate(r.reason, features)).join(" ") : null;
  const finalLabel = moreSevere(modelLabel, policyLabel);
  return { policyLabel, reason, finalLabel, escalated: SEVERITY[finalLabel] > SEVERITY[modelLabel] };
}

module.exports = { applyPolicy, moreSevere, SEVERITY, thresholds: T };
