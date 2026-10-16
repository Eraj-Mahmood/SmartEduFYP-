const { thresholds: T } = require("./policy");

// Turns SHAP drivers into up to 3 short sentences a student understands.
// Never exposes SHAP numbers: only the feature's own value appears in the text.
//
// Each feature has a "concern" sentence (driver raises risk) and a "strength" sentence
// (driver lowers risk). Profile features (who the student is, not what they do) get neutral
// wording and are only used when there aren't enough actionable drivers.
//
// Wording never implies a more severe label than the final one: "high-risk range" and
// "severe-absence limit" are only used when the final label is Dropout-Likely; otherwise the
// sentence states the plain fact ("Your CGPA (1.98) is below 2.00").

const MAX_REASONS = 3;
const LOW_SUBMISSION_PCT = 75; // fallback only: flag submission rates below this

const pct = (v) => `${Math.round(Number(v) * 10) / 10}%`;
const gpa = (v) => Number(v).toFixed(2);
const num = (v) => String(Math.round(Number(v) * 10) / 10);
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;

const PROFILE_CONCERN = "Students with a similar profile to yours have often needed extra support.";
const PROFILE_STRENGTH = "Students with a similar profile to yours have usually done well.";
const PROFILE_FEATURES = new Set(["Semester", "Department", "Gender", "Age", "Scholarship", "Hostel"]);
const GRADE_FEATURES = new Set(["CGPA", "SGPA", "Previous_SGPA"]);
const MAX_GRADE_SENTENCES = 2;

const TEXT = {
  Semester: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },
  Department: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },
  Gender: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },
  Age: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },
  Scholarship: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },
  Hostel: { concern: () => PROFILE_CONCERN, strength: () => PROFILE_STRENGTH },

  Attendance_Percentage: {
    concern: (v, f, label) =>
      v < T.severe_attendance_pct && label === "Dropout-Likely"
        ? `Your attendance (${pct(v)}) is below the ${T.severe_attendance_pct}% severe-absence limit.`
        : v < T.min_attendance_pct
          ? `Your attendance (${pct(v)}) is below the ${T.min_attendance_pct}% requirement.`
          : `Your attendance (${pct(v)}) is lower than students who are doing well.`,
    strength: (v) => `Your attendance (${pct(v)}) is helping you.`,
  },
  Assignment_Avg: {
    concern: (v) => `Your assignment average (${pct(v)}) is pulling your results down.`,
    strength: (v) => `Your assignment average (${pct(v)}) is solid.`,
  },
  Quiz_Avg: {
    concern: (v) => `Your quiz average (${pct(v)}) is pulling your results down.`,
    strength: (v) => `Your quiz average (${pct(v)}) is solid.`,
  },
  Midterm_Marks: {
    concern: (v) => `Your midterm marks (${num(v)}/100) are low.`,
    strength: (v) => `Your midterm marks (${num(v)}/100) are good.`,
  },
  Final_Marks: {
    concern: (v) => `Your final exam marks (${num(v)}/100) are low.`,
    strength: (v) => `Your final exam marks (${num(v)}/100) are good.`,
  },
  Study_Hours_Per_Week: {
    concern: (v) => `You study about ${num(v)} hours a week, less than students who are doing well.`,
    strength: (v) => `Your study time (about ${num(v)} hours a week) is paying off.`,
  },
  LMS_Login_Count: {
    concern: (v) => `You have logged in to the learning portal only ${plural(v, "time")} this term.`,
    strength: (v) => `You use the learning portal regularly (${plural(v, "login")} this term).`,
  },
  Assignment_Submission_Rate: {
    concern: (v) => `You have submitted only ${pct(v)} of your assignments.`,
    strength: (v) => `You submit your assignments reliably (${pct(v)}).`,
  },
  Previous_SGPA: {
    concern: (v) => `Your SGPA last term (${gpa(v)}) was low.`,
    strength: (v) => `Your SGPA last term (${gpa(v)}) was good.`,
  },
  SGPA: {
    concern: (v) => `Your SGPA this term (${gpa(v)}) is low.`,
    strength: (v) => `Your SGPA this term (${gpa(v)}) is good.`,
  },
  CGPA: {
    concern: (v, f, label) =>
      v < T.probation_cgpa
        ? label === "Dropout-Likely"
          ? `Your CGPA (${gpa(v)}) is in the high-risk range.`
          : `Your CGPA (${gpa(v)}) is below ${gpa(T.probation_cgpa)}.`
        : v < T.at_risk_cgpa
          ? `Your CGPA (${gpa(v)}) is below the ${gpa(T.at_risk_cgpa)} good-standing threshold.`
          : `Your CGPA (${gpa(v)}) is lower than students who are doing well.`,
    strength: (v) => `Your CGPA (${gpa(v)}) is in good standing.`,
  },
  Failed_Courses: {
    concern: (v) => (Number(v) > 0 ? `You have failed ${plural(v, "course")}.` : "Your course results need attention."),
    strength: (v) => (Number(v) === 0 ? "You haven't failed any courses." : `You have kept failed courses to ${v}.`),
  },
  Credits_Enrolled: {
    concern: (v) => `Your course load (${v} credits) is heavy.`,
    strength: (v) => `Your course load (${v} credits) is manageable.`,
  },
  Credits_Passed: {
    concern: (v, f) => `You passed ${v} of your ${f.Credits_Enrolled} enrolled credits.`,
    strength: (v, f) => `You passed ${v} of your ${f.Credits_Enrolled} enrolled credits.`,
  },
};

// Staff wording (faculty drawer, admin views): the same facts, stated about the student
// rather than to them, e.g. "CGPA 1.98 is below 2.00". Same severity cap as TEXT.
const STAFF_PROFILE_CONCERN = "Students with a similar profile have often needed extra support.";
const STAFF_PROFILE_STRENGTH = "Students with a similar profile have usually done well.";
const STAFF_TEXT = {
  Semester: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },
  Department: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },
  Gender: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },
  Age: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },
  Scholarship: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },
  Hostel: { concern: () => STAFF_PROFILE_CONCERN, strength: () => STAFF_PROFILE_STRENGTH },

  Attendance_Percentage: {
    concern: (v, f, label) =>
      v < T.severe_attendance_pct && label === "Dropout-Likely"
        ? `Attendance ${pct(v)} is below the ${T.severe_attendance_pct}% severe-absence limit.`
        : v < T.min_attendance_pct
          ? `Attendance ${pct(v)} is below the ${T.min_attendance_pct}% requirement.`
          : `Attendance ${pct(v)} is lower than that of students doing well.`,
    strength: (v) => `Attendance ${pct(v)} is a strength.`,
  },
  Assignment_Avg: {
    concern: (v) => `Assignment average ${pct(v)} is pulling results down.`,
    strength: (v) => `Assignment average ${pct(v)} is solid.`,
  },
  Quiz_Avg: {
    concern: (v) => `Quiz average ${pct(v)} is pulling results down.`,
    strength: (v) => `Quiz average ${pct(v)} is solid.`,
  },
  Midterm_Marks: {
    concern: (v) => `Midterm marks ${num(v)}/100 are low.`,
    strength: (v) => `Midterm marks ${num(v)}/100 are good.`,
  },
  Final_Marks: {
    concern: (v) => `Final exam marks ${num(v)}/100 are low.`,
    strength: (v) => `Final exam marks ${num(v)}/100 are good.`,
  },
  Study_Hours_Per_Week: {
    concern: (v) => `Studies about ${num(v)} h/week, less than students doing well.`,
    strength: (v) => `Study time (about ${num(v)} h/week) is a strength.`,
  },
  LMS_Login_Count: {
    concern: (v) => `Only ${plural(v, "learning-portal login")} this term.`,
    strength: (v) => `Uses the learning portal regularly (${plural(v, "login")} this term).`,
  },
  Assignment_Submission_Rate: {
    concern: (v) => `Submitted only ${pct(v)} of assignments.`,
    strength: (v) => `Submits assignments reliably (${pct(v)}).`,
  },
  Previous_SGPA: {
    concern: (v) => `Last term's SGPA ${gpa(v)} was low.`,
    strength: (v) => `Last term's SGPA ${gpa(v)} was good.`,
  },
  SGPA: {
    concern: (v) => `SGPA this term ${gpa(v)} is low.`,
    strength: (v) => `SGPA this term ${gpa(v)} is good.`,
  },
  CGPA: {
    concern: (v, f, label) =>
      v < T.probation_cgpa
        ? label === "Dropout-Likely"
          ? `CGPA ${gpa(v)} is in the high-risk range (below ${gpa(T.probation_cgpa)}).`
          : `CGPA ${gpa(v)} is below ${gpa(T.probation_cgpa)}.`
        : v < T.at_risk_cgpa
          ? `CGPA ${gpa(v)} is below the ${gpa(T.at_risk_cgpa)} good-standing threshold.`
          : `CGPA ${gpa(v)} is lower than that of students doing well.`,
    strength: (v) => `CGPA ${gpa(v)} is in good standing.`,
  },
  Failed_Courses: {
    concern: (v) => (Number(v) > 0 ? `Has failed ${plural(v, "course")}.` : "Course results need attention."),
    strength: (v) => (Number(v) === 0 ? "No failed courses." : `Failed courses kept to ${v}.`),
  },
  Credits_Enrolled: {
    concern: (v) => `Course load of ${v} credits is heavy.`,
    strength: (v) => `Course load of ${v} credits is manageable.`,
  },
  Credits_Passed: {
    concern: (v, f) => `Passed ${v} of ${f.Credits_Enrolled} enrolled credits.`,
    strength: (v, f) => `Passed ${v} of ${f.Credits_Enrolled} enrolled credits.`,
  },
};

const TEXTS = { student: TEXT, staff: STAFF_TEXT };

// Used when there are no SHAP drivers (rule fallback): flag what the policy cares about.
function driversFromFeatures(f) {
  const concerns = [];
  if (f.CGPA < T.at_risk_cgpa) concerns.push("CGPA");
  if (f.Attendance_Percentage < T.min_attendance_pct) concerns.push("Attendance_Percentage");
  if (f.Failed_Courses > 0) concerns.push("Failed_Courses");
  if (f.Assignment_Submission_Rate < LOW_SUBMISSION_PCT) concerns.push("Assignment_Submission_Rate");
  if (concerns.length) return concerns.map((feature) => ({ feature, direction: "raises_risk" }));
  return ["CGPA", "Attendance_Percentage"].map((feature) => ({ feature, direction: "lowers_risk" }));
}

/**
 * toReasons(drivers, features, finalLabel, {audience}) -> up to 3 sentences.
 * drivers: SHAP explanations [{feature, value, shap, direction}] (most important first), or null.
 * finalLabel caps how severe the wording may sound.
 * audience: 'student' (default, "Your CGPA (1.98) is below 2.00", stored in predictions.reasons)
 * or 'staff' ("CGPA 1.98 is below 2.00", built on read for faculty and admin views).
 * Concerns come before strengths; profile features only fill remaining slots.
 */
function toReasons(drivers, features, finalLabel, { audience = "student" } = {}) {
  const TEXT = TEXTS[audience] || TEXTS.student;
  const list = drivers && drivers.length ? drivers : driversFromFeatures(features);
  const rank = (d) => (PROFILE_FEATURES.has(d.feature) ? 2 : 0) + (d.direction === "raises_risk" ? 0 : 1);
  const ordered = list
    .map((d, i) => ({ ...d, i }))
    .filter((d) => TEXT[d.feature])
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i);

  // CGPA, SGPA and Previous_SGPA say much the same thing: use at most 2 of them unless
  // nothing else is left, so a behavioural driver gets a slot when there is one.
  const out = [];
  const deferred = [];
  let gradeSentences = 0;
  const add = (d) => {
    const value = features[d.feature] ?? d.value;
    const text = TEXT[d.feature][d.direction === "raises_risk" ? "concern" : "strength"](value, features, finalLabel);
    if (!out.includes(text)) out.push(text);
  };
  for (const d of ordered) {
    if (out.length === MAX_REASONS) break;
    if (GRADE_FEATURES.has(d.feature) && gradeSentences === MAX_GRADE_SENTENCES) {
      deferred.push(d);
      continue;
    }
    if (GRADE_FEATURES.has(d.feature)) gradeSentences++;
    add(d);
  }
  for (const d of deferred) {
    if (out.length === MAX_REASONS) break;
    add(d);
  }
  return out;
}

/** Staff wording for a stored predictions row ({drivers, features, final_label, reasons}).
 *  Rebuilt from the same drivers and features, so it says exactly what the student sees. */
function staffReasons(row) {
  if (!row || !row.features) return (row && row.reasons) || [];
  return toReasons(row.drivers, row.features, row.final_label, { audience: "staff" });
}

module.exports = { toReasons, staffReasons };
