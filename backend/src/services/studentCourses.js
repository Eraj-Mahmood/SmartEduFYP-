const pool = require("../config/db");
const { deriveGrade, overallMark, GRADE_THRESHOLDS } = require("./grading");

// This term's courses for one student (enrollments with status 'enrolled'): marks, derived
// grade and attendance. Shared by the student dashboard, next steps and the chat context.
//
// Live-cohort students (admin import, Objective 7) arrive with this term's marks in their live
// student_semester_performance row, not in course_results; featureBuilder feeds those to the model.
// A course without course_results then shows those imported marks (marks_source 'imported') so the
// dashboard and the chat describe the same numbers the model used. Entered marks always win.

// Lowest passing mark (grade D): a course below it counts as "at risk".
const PASS_MARK = GRADE_THRESHOLDS.find(([g]) => g === "D")[1];
const round2 = (x) => (x == null ? null : Math.round(Number(x) * 100) / 100);

/**
 * getCourseSummary(studentId) -> {courses, weakest, present, sessions}
 * courses: [{course_code, title, credit_hours, assignment_avg, quiz_avg, midterm_marks, final_marks,
 *            mean, grade, below_pass_mark, marks_source ('entered' | 'imported' | null), present, sessions,
 *            attendance_pct}] in course-code order.
 * termMarksImported: true when the latest performance row is a live import (see above).
 * weakest: the course with the lowest mean mark, ties broken by the lowest attendance (null when no
 *          marks are entered). The tutorial recommender and the next steps use the same course.
 */
/** This term's marks from a live-cohort import (the latest performance row, when it is live), or null. */
async function importedTermMarks(studentId, db) {
  const { rows } = await db.query(
    `SELECT data_source, assignment_avg, quiz_avg, midterm_marks, final_marks
     FROM student_semester_performance WHERE student_id = $1 ORDER BY semester DESC LIMIT 1`,
    [studentId]
  );
  const r = rows[0];
  if (!r || r.data_source !== "live") return null;
  // all four or nothing: a missing component would count as 0 in the derived grade
  if ([r.assignment_avg, r.quiz_avg, r.midterm_marks, r.final_marks].some((v) => v == null)) return null;
  return r;
}

async function getCourseSummary(studentId, db = pool) {
  const imported = await importedTermMarks(studentId, db);
  const { rows } = await db.query(
    `SELECT c.course_id, c.course_code, c.title, c.credit_hours, e.enrollment_id,
            cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks,
            COUNT(a.attendance_id) FILTER (WHERE a.status = 'present') AS present,
            COUNT(a.attendance_id) AS sessions
     FROM enrollments e
     JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
     JOIN courses c ON c.course_id = fc.course_id
     LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
     LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
     WHERE e.student_id = $1 AND e.status = 'enrolled'
     GROUP BY c.course_id, c.course_code, c.title, c.credit_hours, e.enrollment_id, cr.result_id
     ORDER BY c.course_code`,
    [studentId]
  );

  const courses = rows.map((row) => {
    const entered = row.assignment_avg != null;
    const c = !entered && imported ? { ...row, ...pickMarks(imported) } : row;
    const hasMarks = c.assignment_avg != null;
    const marks = {
      assignment_avg: round2(c.assignment_avg),
      quiz_avg: round2(c.quiz_avg),
      midterm_marks: round2(c.midterm_marks),
      final_marks: round2(c.final_marks),
    };
    const mean = hasMarks ? round2(overallMark(marks)) : null;
    const sessions = Number(c.sessions);
    return {
      course_id: c.course_id,
      course_code: c.course_code,
      title: c.title,
      credit_hours: c.credit_hours,
      ...marks,
      mean,
      grade: hasMarks ? deriveGrade(marks) : null,
      below_pass_mark: hasMarks && mean < PASS_MARK,
      marks_source: entered ? "entered" : hasMarks ? "imported" : null,
      present: Number(c.present),
      sessions,
      attendance_pct: sessions > 0 ? round2((100 * Number(c.present)) / sessions) : null,
    };
  });
  const withMarks = courses.filter((c) => c.mean != null);
  const att = (c) => (c.attendance_pct == null ? Infinity : c.attendance_pct);
  const weaker = (c, w) => c.mean < w.mean || (c.mean === w.mean && att(c) < att(w));
  const weakest = withMarks.length ? withMarks.reduce((w, c) => (weaker(c, w) ? c : w)) : null;
  return {
    courses,
    weakest,
    termMarksImported: !!imported,
    present: courses.reduce((n, c) => n + c.present, 0),
    sessions: courses.reduce((n, c) => n + c.sessions, 0),
  };
}

function pickMarks(r) {
  return { assignment_avg: r.assignment_avg, quiz_avg: r.quiz_avg, midterm_marks: r.midterm_marks, final_marks: r.final_marks };
}

module.exports = { getCourseSummary, importedTermMarks, PASS_MARK, round2 };
