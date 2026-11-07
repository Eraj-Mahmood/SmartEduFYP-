const { buildFeatures, SGPA_SLOPE, SGPA_INTERCEPT } = require("./featureBuilder");
const { getCourseSummary } = require("./studentCourses");
const { GRADE_THRESHOLDS } = require("./grading");
const { thresholds: T } = require("./policy");
const { recommendFor } = require("./tutorials");

// "What to do next": ranked, concrete actions from the student's own numbers.
//   (a) attendance - sessions needed to reach 75% (and 60% when below it), this term's rows
//   (b) marks      - the average course mark needed this term to lift projected CGPA to the
//                    2.00 line and the 2.30 Safe line, using the Phase 1 formulas
//                    provisional SGPA = clamp(0.0640 x mean - 2.453, 0, 4)
//                    projected CGPA   = (Previous_SGPA + SGPA) / 2
//   (c) weakest course, when its mean is below 70
//   (d) the recommended tutorial for that course (services/tutorials.js), when there is one
//   (e) assignment submission, when below 90%
// Lower priority = shown first. Never probabilities. audience 'student' (default) speaks to the
// student ("Your attendance is ..."); 'staff' describes them ("Attendance 58% ... Needs a 72 average").

const WEAK_COURSE_MEAN = 70;
const MIN_SUBMISSION_PCT = 90;
const REALISTIC_GAIN = 10; // when no line is reachable: aim this many marks above today's average

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const gpa = (v) => Number(v).toFixed(2);
const classes = (n) => `${n} class${n === 1 ? "" : "es"}`;
const pct1 = (v) => `${Math.round(v * 10) / 10}%`;

/** Grade for an overall course mark (same thresholds as grading.js). */
function gradeFor(mark) {
  for (const [grade, min] of GRADE_THRESHOLDS) if (mark >= min) return grade;
  return "F";
}

/** Projected CGPA if every course this term ends with this mean mark (rounded like featureBuilder). */
function projectedCgpaFor(mark, previousSgpa) {
  const sgpa = round2(clamp(SGPA_SLOPE * mark + SGPA_INTERCEPT, 0, 4));
  return round2((previousSgpa + sgpa) / 2);
}

/** Smallest whole-number mean mark that lifts projected CGPA to `target` (may be > 100 = unreachable). */
function markNeededFor(target, previousSgpa) {
  const sgpaNeeded = 2 * target - previousSgpa;
  if (sgpaNeeded > 4) return Infinity;
  let mark = Math.max(0, Math.ceil((sgpaNeeded - SGPA_INTERCEPT) / SGPA_SLOPE));
  while (mark <= 100 && projectedCgpaFor(mark, previousSgpa) < target) mark++;
  while (mark > 0 && projectedCgpaFor(mark - 1, previousSgpa) >= target) mark--;
  return mark;
}

/** Sessions to attend in a row (no absences) so present/sessions reaches pct. */
function sessionsNeeded(present, sessions, pct) {
  const t = pct / 100;
  return Math.max(0, Math.ceil((t * sessions - present) / (1 - t) - 1e-9));
}

/** The model inputs if every course this term ended with `mark` in all four components. */
function whatIfFeatures(features, mark) {
  const sgpa = round2(clamp(SGPA_SLOPE * mark + SGPA_INTERCEPT, 0, 4));
  return {
    ...features,
    Assignment_Avg: mark,
    Quiz_Avg: mark,
    Midterm_Marks: mark,
    Final_Marks: mark,
    SGPA: sgpa,
    CGPA: round2((features.Previous_SGPA + sgpa) / 2),
  };
}

function attendanceStep(present, sessions, staff = false) {
  if (!sessions) return null;
  const now = round2((100 * present) / sessions);
  if (now >= T.min_attendance_pct) return null;
  const toMin = sessionsNeeded(present, sessions, T.min_attendance_pct);
  const detail = { attendance_pct: now, present, sessions, sessions_to_75: toMin };
  if (now < T.severe_attendance_pct) {
    const toSevere = sessionsNeeded(present, sessions, T.severe_attendance_pct);
    detail.sessions_to_60 = toSevere;
    return {
      id: "attendance",
      priority: 10,
      text: staff
        ? `Attendance ${pct1(now)} (${present} of ${sessions} classes). Needs the next ${classes(toSevere)} in a row ` +
          `to get back above ${T.severe_attendance_pct}%, and ${toMin} to reach ${T.min_attendance_pct}%.`
        : `Your attendance is ${pct1(now)} (${present} of ${sessions} classes). Attend the next ${classes(toSevere)} ` +
          `in a row to get back above ${T.severe_attendance_pct}%, and ${toMin} to reach ${T.min_attendance_pct}%.`,
      detail,
    };
  }
  return {
    id: "attendance",
    priority: 25,
    text: staff
      ? `Attendance ${pct1(now)} (${present} of ${sessions} classes). Needs the next ${classes(toMin)} without an absence ` +
        `to reach ${T.min_attendance_pct}%.`
      : `Your attendance is ${pct1(now)} (${present} of ${sessions} classes). Attend the next ${classes(toMin)} ` +
        `without missing one to reach ${T.min_attendance_pct}%.`,
    detail,
  };
}

function marksStep(features, sources, courses, staff = false) {
  const marked = courses.filter((c) => c.mean != null);
  if (!marked.length || sources.CGPA !== "projected") return null;
  const credits = marked.reduce((n, c) => n + c.credit_hours, 0);
  const mean = round2(marked.reduce((n, c) => n + c.credit_hours * c.mean, 0) / credits);
  const prev = features.Previous_SGPA;
  const cgpa = features.CGPA;
  const toLine = markNeededFor(T.probation_cgpa, prev);
  const toSafe = markNeededFor(T.at_risk_cgpa, prev);
  const now = Math.round(mean);
  const detail = { current_mean: mean, projected_cgpa: cgpa, previous_sgpa: prev, mark_for_2_00: toLine, mark_for_2_30: toSafe };
  const markText = (m) => `${m} (${gradeFor(m)})`;
  // marks alone can't make the status Safe while attendance is under the minimum
  const attNote =
    features.Attendance_Percentage < T.min_attendance_pct
      ? staff
        ? ` Attendance also needs to reach ${T.min_attendance_pct}% for a Safe status.`
        : ` Your attendance also needs to reach ${T.min_attendance_pct}% for a Safe status.`
      : "";

  // already in good standing: say what keeps it there
  if (cgpa >= T.at_risk_cgpa) {
    detail.goal = { mark: toSafe, cgpa: T.at_risk_cgpa };
    return {
      id: "marks",
      priority: 90,
      text: staff
        ? `Needs to keep a ${toSafe} average in every course to stay above ${gpa(T.at_risk_cgpa)} (average now ${now}).`
        : `Keep your average at ${toSafe} or more in every course to stay above ${gpa(T.at_risk_cgpa)}. Your average now is ${now}, so you have some room.`,
      detail,
    };
  }

  if (toSafe <= now) {
    // the average is there, but some courses are well below it (each course counts on its own)
    const below = marked.filter((c) => c.mean < toSafe).map((c) => c.course_code);
    detail.goal = { mark: toSafe, cgpa: T.at_risk_cgpa };
    return {
      id: "marks",
      priority: 30,
      text: staff
        ? `Needs every course at ${markText(toSafe)} or more to reach ${gpa(T.at_risk_cgpa)}${below.length ? ` - ${below.join(", ")} ${below.length === 1 ? "is" : "are"} below that` : ""} (projected CGPA now ${gpa(cgpa)}).${attNote}`
        : `Bring every course up to at least ${markText(toSafe)}${below.length ? ` - ${below.join(", ")} ${below.length === 1 ? "is" : "are"} below that` : ""}. That would lift your projected CGPA from ${gpa(cgpa)} to ${gpa(T.at_risk_cgpa)}, the Safe line.${attNote}`,
      detail,
    };
  }

  if (toSafe <= 100) {
    detail.goal = { mark: toSafe, cgpa: T.at_risk_cgpa };
    const lineNote =
      cgpa < T.probation_cgpa && toLine > mean
        ? staff
          ? ` ${markText(toLine)} would reach ${gpa(T.probation_cgpa)}.`
          : ` On the way, ${markText(toLine)} would bring it to ${gpa(T.probation_cgpa)}.`
        : "";
    return {
      id: "marks",
      priority: cgpa < T.probation_cgpa ? 20 : 30,
      text: staff
        ? `Needs a ${markText(toSafe)} average in every course to reach ${gpa(T.at_risk_cgpa)} (average now ${now}, projected CGPA ${gpa(cgpa)}).${lineNote}${attNote}`
        : `Aim for an average of ${markText(toSafe)} in every course this term (now ${now}). ` +
          `That would lift your projected CGPA from ${gpa(cgpa)} to ${gpa(T.at_risk_cgpa)}, the Safe line.${lineNote}${attNote}`,
      detail,
    };
  }

  // Safe isn't reachable this term: be honest, then give the most useful realistic goal.
  const why = staff
    ? `${gpa(T.at_risk_cgpa)} (Safe) is out of reach this term even with full marks (previous SGPA ${gpa(prev)}).`
    : `Reaching ${gpa(T.at_risk_cgpa)} (Safe) isn't possible this term, even with full marks, because last term's SGPA (${gpa(prev)}) still counts.`;
  if (toLine <= 100 && cgpa < T.probation_cgpa) {
    detail.goal = { mark: toLine, cgpa: T.probation_cgpa };
    return {
      id: "marks",
      priority: 20,
      text: staff
        ? `${why} Realistic goal: a ${markText(toLine)} average in every course (now ${now}) reaches ${gpa(T.probation_cgpa)} (projected CGPA now ${gpa(cgpa)}).`
        : `${why} A realistic goal: an average of ${markText(toLine)} in every course (now ${now}) would lift your projected CGPA from ${gpa(cgpa)} to ${gpa(T.probation_cgpa)}.`,
      detail,
    };
  }
  const goal = Math.min(100, now + REALISTIC_GAIN);
  const goalCgpa = projectedCgpaFor(goal, prev);
  detail.goal = { mark: goal, cgpa: goalCgpa };
  return {
    id: "marks",
    priority: 20,
    text: staff
      ? `${why} Realistic goal: raising the average from ${now} to ${markText(goal)} lifts projected CGPA from ${gpa(cgpa)} to ${gpa(goalCgpa)}.`
      : `${why} A realistic goal: raise your average from ${now} to ${markText(goal)}. That would lift your projected CGPA from ${gpa(cgpa)} to ${gpa(goalCgpa)} and set you up for next term.`,
    detail,
  };
}

function weakestStep(weakest, staff = false) {
  if (!weakest || weakest.mean >= WEAK_COURSE_MEAN) return null;
  const att =
    weakest.attendance_pct != null && weakest.attendance_pct < T.min_attendance_pct
      ? staff
        ? `, attendance there ${weakest.attendance_pct}%`
        : ` and your attendance there is ${weakest.attendance_pct}%`
      : "";
  return {
    id: "weakest_course",
    priority: 40,
    text: staff
      ? `Weakest course ${weakest.course_code} (${weakest.title}): average ${Math.round(weakest.mean)} (${weakest.grade})${att}. ` +
        `Worth checking which upcoming assessments carry the most marks.`
      : `Focus on ${weakest.course_code} (${weakest.title}): your average there is ${Math.round(weakest.mean)} (${weakest.grade})${att}. ` +
        `Ask your teacher which upcoming assessments carry the most marks.`,
    detail: { course_code: weakest.course_code, mean: weakest.mean, grade: weakest.grade, attendance_pct: weakest.attendance_pct },
  };
}

function tutorialStep(rec, staff = false) {
  if (!rec || !rec.tutorial) return null;
  const t = rec.tutorial;
  return {
    id: "tutorial",
    priority: 41,
    text: staff
      ? `Point them to "${t.title}"${t.provider ? ` (${t.provider})` : ""} for ${rec.course.course_code}.`
      : `Work through "${t.title}"${t.provider ? ` (${t.provider})` : ""} for ${rec.course.course_code}. ${rec.reason}.`,
    detail: { course_code: rec.course.course_code, tutorial_id: t.tutorial_id, title: t.title, url: t.url, provider: t.provider, kind: t.kind },
  };
}

function submissionStep(features, staff = false) {
  if (features.Assignment_Submission_Rate == null) return null; // unknown (live cohort)
  const rate = Number(features.Assignment_Submission_Rate);
  if (!(rate < MIN_SUBMISSION_PCT)) return null;
  return {
    id: "submission",
    priority: 45,
    text: staff
      ? `Assignment submission rate ${round2(rate)}% - every remaining assignment needs to go in on time.`
      : `Submit every remaining assignment on time - you have submitted ${round2(rate)}% so far. Each missing one costs marks you can still earn.`,
    detail: { submission_rate: round2(rate) },
  };
}

/** computeNextSteps({features, sources}, {courses, weakest, present, sessions}, recommendation?, {audience}) -> ranked steps. Pure. */
function computeNextSteps(built, summary, recommendation = null, { audience = "student" } = {}) {
  const staff = audience === "staff";
  const steps = [
    attendanceStep(summary.present, summary.sessions, staff),
    marksStep(built.features, built.sources || {}, summary.courses, staff),
    weakestStep(summary.weakest, staff),
    tutorialStep(recommendation, staff),
    submissionStep(built.features, staff),
  ].filter(Boolean);
  return steps.sort((a, b) => a.priority - b.priority);
}

/** getNextSteps(studentId, {audience}) -> [{id, priority, text, detail}], most important first. */
async function getNextSteps(studentId, { audience = "student" } = {}) {
  const [built, summary] = await Promise.all([buildFeatures(studentId), getCourseSummary(studentId)]);
  if (!built) return [];
  return computeNextSteps(built, summary, await recommendFor(studentId, { summary }), { audience });
}

module.exports = { getNextSteps, computeNextSteps, whatIfFeatures, markNeededFor, projectedCgpaFor, sessionsNeeded, gradeFor };
