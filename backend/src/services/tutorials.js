const pool = require("../config/db");
const { getCourseSummary } = require("./studentCourses");
const { thresholds: T } = require("./policy");

// Tutorial recommender (FR11): one piece of study material for the course that needs it most.
//
// recommendFor(studentId) -> {course, tutorial, reason} | null
//   course:   the weakest current course (lowest mean mark, ties -> lowest attendance; the same
//             rule as studentCourses.weakest, so it matches the "weakest_course" next step)
//   tutorial: that course's first active tutorial, or null when it has none
//   reason:   one plain sentence for the student
// It recommends only when that course's mean is below 70, its attendance is below 75%, or the
// student's latest label is At-Risk / Dropout-Likely. Otherwise null.

const WEAK_MEAN = 70;
const FLAGGED = new Set(["At-Risk", "Dropout-Likely"]);

const mark = (v) => String(Math.round(Number(v)));
const pct = (v) => `${Math.round(Number(v) * 10) / 10}%`;

/** The first active tutorial per course id: Map(course_id -> tutorial). */
async function activeTutorials(courseIds, db = pool) {
  if (!courseIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (course_id) tutorial_id, course_id, title, url, provider, kind, description
     FROM tutorials WHERE is_active AND course_id = ANY($1)
     ORDER BY course_id, tutorial_id`,
    [courseIds]
  );
  return new Map(rows.map((r) => [r.course_id, r]));
}

/** The plain sentence that explains the pick. Pure. */
function reasonFor(course, label) {
  const lowMark = course.mean < WEAK_MEAN;
  const lowAtt = course.attendance_pct != null && course.attendance_pct < T.min_attendance_pct;
  if (lowMark && lowAtt) {
    return `Your ${course.course_code} average is ${mark(course.mean)} and your attendance there is ${pct(course.attendance_pct)} - this helps you catch up on its core topics`;
  }
  if (lowMark) return `Your ${course.course_code} average is ${mark(course.mean)} - this covers its core topics`;
  if (lowAtt) return `Your ${course.course_code} attendance is ${pct(course.attendance_pct)} - this helps you catch up on classes you missed`;
  return `${course.course_code} is your lowest course (average ${mark(course.mean)}) - this helps you keep it on track`;
}

/** Pure pick from a course summary + label + tutorials map. Exported for tests and batch use. */
function pickRecommendation(summary, label, tutorialsByCourse) {
  const c = summary.weakest;
  if (!c) return null;
  const needs =
    c.mean < WEAK_MEAN ||
    (c.attendance_pct != null && c.attendance_pct < T.min_attendance_pct) ||
    FLAGGED.has(label);
  if (!needs) return null;
  const t = tutorialsByCourse.get(c.course_id) || null;
  return {
    course: { course_id: c.course_id, course_code: c.course_code, title: c.title, mean: c.mean, attendance_pct: c.attendance_pct },
    tutorial: t && { tutorial_id: t.tutorial_id, title: t.title, url: t.url, provider: t.provider, kind: t.kind, description: t.description },
    reason: reasonFor(c, label),
  };
}

/**
 * recommendFor(studentId, {summary, label, db}) - summary (getCourseSummary) and label (latest
 * final_label) are looked up when not passed in.
 */
async function recommendFor(studentId, { summary, label, db = pool } = {}) {
  const [s, l] = await Promise.all([
    summary || getCourseSummary(studentId, db),
    label !== undefined
      ? label
      : db
          .query(
            `SELECT p.final_label FROM students s JOIN predictions p ON p.prediction_id = s.latest_prediction_id
             WHERE s.student_id = $1`,
            [studentId]
          )
          .then((r) => (r.rows[0] ? r.rows[0].final_label : null)),
  ]);
  if (!s.weakest) return null;
  return pickRecommendation(s, l, await activeTutorials([s.weakest.course_id], db));
}

module.exports = { recommendFor, pickRecommendation, activeTutorials, reasonFor, WEAK_MEAN };
