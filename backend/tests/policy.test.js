// Policy layer (services/policy.js + config/policy.json) and plain-language reasons
// (services/reasons.js). Pure unit tests: no database, no ML service.
const { applyPolicy, SEVERITY, thresholds: T } = require("../src/services/policy");
const { toReasons, staffReasons } = require("../src/services/reasons");
const { ruleBasedFallback } = require("../src/services/predictionService");

const LABELS = ["Safe", "At-Risk", "Dropout-Likely"];
const base = { CGPA: 3.2, Previous_SGPA: 3.1, Attendance_Percentage: 92, SGPA: 3.3 };

// each case: features that make the policy say `policy`
const POLICY_CASES = [
  ["no rule fires", base, "Safe"],
  ["CGPA below 2.30", { ...base, CGPA: 2.29 }, "At-Risk"],
  ["attendance below 75%", { ...base, Attendance_Percentage: 74.9 }, "At-Risk"],
  ["attendance below 60%", { ...base, Attendance_Percentage: 59.9 }, "Dropout-Likely"],
  ["CGPA and previous SGPA both below 2.00", { ...base, CGPA: 1.99, Previous_SGPA: 1.5 }, "Dropout-Likely"],
];

describe("rules", () => {
  test.each(POLICY_CASES)("%s -> policy %s", (_name, f, policy) => {
    expect(applyPolicy(f, "Safe").policyLabel).toBe(policy);
  });

  test("thresholds are the documented ones", () => {
    expect(T).toEqual({ probation_cgpa: 2.0, at_risk_cgpa: 2.3, severe_attendance_pct: 60, min_attendance_pct: 75 });
  });

  test("boundaries: exactly 2.30 and exactly 75% are not below the line", () => {
    expect(applyPolicy({ ...base, CGPA: 2.3, Attendance_Percentage: 75 }, "Safe").policyLabel).toBe("Safe");
  });

  test("CGPA below 2.00 alone (previous SGPA fine) is At-Risk, not Dropout-Likely", () => {
    expect(applyPolicy({ ...base, CGPA: 1.9, Previous_SGPA: 2.5 }, "Safe").policyLabel).toBe("At-Risk");
  });

  test("a missing value never fires a rule (live cohort)", () => {
    const r = applyPolicy({ CGPA: null, Previous_SGPA: null, Attendance_Percentage: null }, "Safe");
    expect(r).toMatchObject({ policyLabel: "Safe", reason: null, finalLabel: "Safe" });
  });

  test("the reason names the deciding rule with the student's numbers", () => {
    const r = applyPolicy({ ...base, CGPA: 1.62, Previous_SGPA: 1.64 }, "Safe");
    expect(r.reason).toMatch(/1\.62/);
    expect(r.reason).toMatch(/1\.64/);
    expect(r.reason).toMatch(/2\.00/);
  });
});

describe("the policy only escalates", () => {
  const cases = LABELS.flatMap((model) => POLICY_CASES.map(([name, f, policy]) => [model, name, f, policy]));
  test.each(cases)("model %s + %s", (model, _name, f, policy) => {
    const r = applyPolicy(f, model);
    const expected = SEVERITY[policy] > SEVERITY[model] ? policy : model;
    expect(r.finalLabel).toBe(expected);
    expect(SEVERITY[r.finalLabel]).toBeGreaterThanOrEqual(SEVERITY[model]); // never lower than the model
    expect(r.escalated).toBe(SEVERITY[policy] > SEVERITY[model]);
  });
});

describe("rule-based fallback (ML service down)", () => {
  test.each(POLICY_CASES)("%s -> fallback label = policy label %s", (_name, f, policy) => {
    const fb = ruleBasedFallback(f);
    expect(fb.label).toBe(policy);
    expect(fb.model_version).toBe("rule_fallback");
    expect(fb.prob_safe + fb.prob_at_risk + fb.prob_dropout).toBeCloseTo(1, 6);
  });
});

describe("plain-language reasons", () => {
  const f = { ...base, CGPA: 1.62, Previous_SGPA: 1.64, Attendance_Percentage: 62.5, Failed_Courses: 2, Assignment_Submission_Rate: 55.1 };
  const drivers = [
    { feature: "CGPA", value: 1.62, shap: 0.4123, direction: "raises_risk" },
    { feature: "Previous_SGPA", value: 1.64, shap: 0.2311, direction: "raises_risk" },
    { feature: "Attendance_Percentage", value: 62.5, shap: 0.1987, direction: "raises_risk" },
    { feature: "Failed_Courses", value: 2, shap: 0.05, direction: "raises_risk" },
  ];

  test("at most 3 sentences, with the student's numbers and no SHAP values", () => {
    const r = toReasons(drivers, f, "Dropout-Likely");
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(3);
    const text = r.join(" ");
    expect(text).toMatch(/1\.62/);
    for (const d of drivers) expect(text).not.toContain(String(d.shap));
    expect(text).not.toMatch(/shap|probab/i);
  });

  test("student wording addresses the student; staff wording describes them", () => {
    const student = toReasons(drivers, f, "Dropout-Likely").join(" ");
    const staff = toReasons(drivers, f, "Dropout-Likely", { audience: "staff" }).join(" ");
    expect(student).toMatch(/\bYour\b/);
    expect(staff).not.toMatch(/\bYour\b/);
  });

  test("wording never sounds more severe than the label", () => {
    const atRisk = toReasons(drivers, f, "At-Risk").join(" ");
    expect(atRisk).not.toMatch(/high-risk range|severe-absence/);
    const dl = toReasons(drivers, f, "Dropout-Likely").join(" ");
    expect(dl).toMatch(/high-risk range|severe/);
  });

  test("a Safe student hears what is working, without drivers (fallback rows)", () => {
    const r = toReasons(null, base, "Safe");
    expect(r.length).toBeGreaterThan(0);
    expect(r.join(" ")).toMatch(/3\.20|good/);
  });

  test("unknown values are skipped, never printed as null/NaN", () => {
    const r = toReasons(null, { CGPA: 2.1, Previous_SGPA: null, Attendance_Percentage: null, Assignment_Submission_Rate: null }, "At-Risk");
    expect(r.join(" ")).not.toMatch(/null|NaN|undefined/);
  });

  test("staffReasons rebuilds staff wording from a stored row", () => {
    const row = { drivers, features: f, final_label: "Dropout-Likely", reasons: ["old wording"] };
    const r = staffReasons(row);
    expect(r.join(" ")).toMatch(/1\.62/);
    expect(r.join(" ")).not.toMatch(/\bYour\b/);
  });
});
