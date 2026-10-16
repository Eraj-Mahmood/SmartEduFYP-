const pool = require("../config/db");
const { deriveGrade, overallMark, GRADE_THRESHOLDS } = require("./grading");

// This term's courses for one student (enrollments with status 'enrolled'): marks, derived
// grade and attendance. Shared by the student dashboard, next steps and the chat context.

// Lowest passing mark (grade D): a course below it counts as "at risk".
const PASS_MARK = GRADE_THRESHOLDS.find(([g]) => g === "D")[1];
const round2 = (x) => (x == null ? null : Math.round(Number(x) * 100) / 100);

/**
 * getCourseSummary(studentId) -> {courses, weakest, present, sessions}
 * courses: [{course_code, title, credit_hours, assignment_avg, quiz_avg, midterm_marks, final_marks,
 *            mean, grade, below_pass_mark, present, sessions, attendance_pct}] in course-code order.
 * weakest: the course with the lowest mean mark (null when no marks are entered).
 */
async function getCourseSummary(studentId, db = pool) {
  const { rows } = await db.query(
    `SELECT c.course_code, c.title, c.credit_hours, e.enrollment_id,
            cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks,
            COUNT(a.attendance_id) FILTER (WHERE a.status = 'present') AS present,
            COUNT(a.attendance_id) AS sessions
     FROM enrollments e
     JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
     JOIN courses c ON c.course_id = fc.course_id
     LEFT JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
     LEFT JOIN attendance a ON a.enrollment_id = e.enrollment_id
     WHERE e.student_id = $1 AND e.status = 'enrolled'
     GROUP BY c.course_code, c.title, c.credit_hours, e.enrollment_id, cr.result_id
     ORDER BY c.course_code`,
    [studentId]
  );

  const courses = rows.map((c) => {
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
      course_code: c.course_code,
      title: c.title,
      credit_hours: c.credit_hours,
      ...marks,
      mean,
      grade: hasMarks ? deriveGrade(marks) : null,
      below_pass_mark: hasMarks && mean < PASS_MARK,
      present: Number(c.present),
      sessions,
      attendance_pct: sessions > 0 ? round2((100 * Number(c.present)) / sessions) : null,
    };
  });
  const withMarks = courses.filter((c) => c.mean != null);
  const weakest = withMarks.length ? withMarks.reduce((w, c) => (c.mean < w.mean ? c : w)) : null;
  return {
    courses,
    weakest,
    present: courses.reduce((n, c) => n + c.present, 0),
    sessions: courses.reduce((n, c) => n + c.sessions, 0),
  };
}

module.exports = { getCourseSummary, PASS_MARK, round2 };
