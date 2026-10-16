// Checks the "marks needed" next step against the real model.
// For each At-Risk / Dropout-Likely demo student: build the live features, set every course
// mark to the suggested average (the 2.00 line, the 2.30 Safe line and the step's goal),
// call the ML service /predict and the policy layer, and compare with what the step promises.
//
// Usage (ML service running): cd backend; node ../evaluation/next_steps_whatif.js
require("../backend/node_modules/dotenv").config({ path: require("path").join(__dirname, "../backend/.env") });
const pool = require("../backend/src/config/db");
const { buildFeatures } = require("../backend/src/services/featureBuilder");
const { getNextSteps, whatIfFeatures } = require("../backend/src/services/nextSteps");
const { applyPolicy, thresholds: T } = require("../backend/src/services/policy");

const ROLLS = ["BU-122785", "BU-112907", "BU-144766", "BU-101986"];

async function predict(features) {
  const res = await fetch(process.env.ML_SERVICE_URL.replace("localhost", "127.0.0.1"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features }),
  });
  if (!res.ok) throw new Error(`ML ${res.status}`);
  return (await res.json()).label;
}

// What the step promises for a projected CGPA, everything else unchanged.
function expected(f) {
  return applyPolicy(f, "Safe").policyLabel;
}

(async () => {
  const rows = [];
  for (const roll of ROLLS) {
    const { rows: s } = await pool.query("SELECT student_id FROM students WHERE roll_no = $1", [roll]);
    const id = s[0].student_id;
    const built = await buildFeatures(id);
    const steps = await getNextSteps(id);
    const m = steps.find((x) => x.id === "marks");
    const now = await predict(built.features);
    const cases = [
      ["today", null, built.features],
      ["2.00 line", m.detail.mark_for_2_00, null],
      ["2.30 line", m.detail.mark_for_2_30, null],
    ];
    for (const [name, mark, f0] of cases) {
      if (mark != null && mark > 100) {
        rows.push({ roll, case: name, mark: ">100", cgpa: "-", model: "-", policy: "-", agrees: "n/a (not reachable)" });
        continue;
      }
      const f = f0 || whatIfFeatures(built.features, mark);
      const model = f0 ? now : await predict(f);
      const pol = expected(f);
      const final = applyPolicy(f, model).finalLabel;
      rows.push({
        roll,
        case: name,
        mark: mark ?? Math.round(m.detail.current_mean),
        cgpa: f.CGPA,
        attendance: f.Attendance_Percentage,
        model,
        policy: pol,
        final,
        agrees: model === pol ? "yes" : "no",
      });
    }
  }
  console.table(rows);
  console.log(`(policy = the label the rules give for that projected CGPA with today's attendance; thresholds ${JSON.stringify(T)})`);
  await pool.end();
})();
