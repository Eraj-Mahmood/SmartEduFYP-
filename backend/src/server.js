require("dotenv").config();
const app = require("./app");
const { markInterruptedRuns } = require("./services/predictionRuns");

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SmartEdu backend running on http://localhost:${PORT}`);
  markInterruptedRuns().catch((e) => console.error("Could not tidy interrupted prediction runs:", e.message));
});
