// Everything the UI says about a risk label lives here, including the supportive wording
// shown to students (the formal label is shown underneath it).

export const RISK_LABELS = ["Safe", "At-Risk", "Dropout-Likely"];

export const RISK = {
  Safe: {
    formal: "Safe",
    supportive: "You're on track",
    short: "Safe",
    tone: "safe",
  },
  "At-Risk": {
    formal: "At-Risk",
    supportive: "Needs attention",
    short: "Needs attention",
    tone: "risk",
  },
  "Dropout-Likely": {
    formal: "Dropout-Likely",
    supportive: "High risk - let's act now",
    short: "High risk",
    tone: "danger",
  },
};

export const RISK_SEVERITY = { Safe: 0, "At-Risk": 1, "Dropout-Likely": 2 };

export function riskMeta(label) {
  return RISK[label] || { formal: label || "Unknown", supportive: "No prediction yet", short: label || "Unknown", tone: "neutral" };
}
