const pool = require("../config/db");

// Builds the 20 model inputs for a student from live data where it exists.
//
// Base: the student's latest student_semester_performance row (the imported dataset row).
// Overrides, from the student's current-semester enrollments (status 'enrolled'):
//   - Attendance_Percentage  = present / total sessions                      -> "live"
//   - Assignment_Avg, Quiz_Avg, Midterm_Marks, Final_Marks = mean over courses -> "live"
//   - SGPA = credit-weighted per-course points from the marks                  -> "provisional"
//   - CGPA = (Previous_SGPA + SGPA) / 2                                        -> "projected"
//
// SGPA/CGPA formulas come from evaluation/sgpa_cgpa_relationship.py on the 50k-row CSV:
//   SGPA ~= 0.0640 * mean_mark - 2.453            (R2 0.969; letter points 4/3/2/1/0 overstate SGPA by ~0.46)
//   CGPA ~= (Previous_SGPA + SGPA) / 2            (R2 0.992; same weights in every semester)
// Credits_Enrolled / Credits_Passed / Failed_Courses stay as imported: the seeded enrollments
// (4 x 3 = 12 credits) are below the dataset's minimum of 15, so overriding them would put the
// model out of distribution.

const SGPA_SLOPE = 0.064;
const SGPA_INTERCEPT = -2.453;

const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Grade points (0-4) for one course on the dataset's SGPA scale. */
function coursePoints(r) {
  const mean = (Number(r.assignment_avg) + Number(r.quiz_avg) + Number(r.midterm_marks) + Number(r.final_marks)) / 4;
  return clamp(SGPA_SLOPE * mean + SGPA_INTERCEPT, 0, 4);
}

/**
 * Builds features for many students with three set-based queries.
 * Returns Map(studentId -> {features, sources, extra}); students with no performance row are absent.
 * `extra` holds non-model inputs the policy layer needs (Warning_Count, Consecutive_Low_CGPA).
 */
async function buildFeaturesMany(studentIds, db = pool) {
  const ids = studentIds.map(Number);
  const [perf, att, courses] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (p.student_id) p.*, s.gender, s.age, s.scholarship, s.hostel, d.code AS department_code
       FROM student_semester_performance p
       JOIN students s ON s.student_id = p.student_id
       JOIN departments d ON d.department_id = s.department_id
       WHERE p.student_id = ANY($1)
       ORDER BY p.student_id, p.semester DESC`,
      [ids]
    ),
    db.query(
      `SELECT e.student_id,
              COUNT(*) FILTER (WHERE a.status = 'present') AS present,
              COUNT(*) AS total
       FROM enrollments e
       JOIN attendance a ON a.enrollment_id = e.enrollment_id
       WHERE e.student_id = ANY($1) AND e.status = 'enrolled'
       GROUP BY e.student_id`,
      [ids]
    ),
    db.query(
      `SELECT e.student_id, c.credit_hours, cr.assignment_avg, cr.quiz_avg, cr.midterm_marks, cr.final_marks
       FROM enrollments e
       JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
       JOIN courses c ON c.course_id = fc.course_id
       JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
       WHERE e.student_id = ANY($1) AND e.status = 'enrolled'`,
      [ids]
    ),
  ]);

  const attByStudent = new Map(att.rows.map((r) => [r.student_id, r]));
  const coursesByStudent = new Map();
  for (const r of courses.rows) {
    if (!coursesByStudent.has(r.student_id)) coursesByStudent.set(r.student_id, []);
    coursesByStudent.get(r.student_id).push(r);
  }

  const out = new Map();
  for (const r of perf.rows) {
    const features = {
      Semester: r.semester,
      Department: r.department_code,
      Gender: r.gender,
      Age: r.age,
      Attendance_Percentage: Number(r.attendance_percentage),
      Assignment_Avg: Number(r.assignment_avg),
      Quiz_Avg: Number(r.quiz_avg),
      Midterm_Marks: Number(r.midterm_marks),
      Final_Marks: Number(r.final_marks),
      Study_Hours_Per_Week: Number(r.study_hours_per_week),
      LMS_Login_Count: r.lms_login_count,
      Assignment_Submission_Rate: Number(r.assignment_submission_rate),
      Previous_SGPA: Number(r.previous_sgpa),
      SGPA: Number(r.sgpa),
      CGPA: Number(r.cgpa),
      Failed_Courses: r.failed_courses,
      Credits_Enrolled: r.credits_enrolled,
      Credits_Passed: r.credits_passed,
      Scholarship: r.scholarship,
      Hostel: r.hostel,
    };
    const sources = {};

    const a = attByStudent.get(r.student_id);
    if (a && Number(a.total) > 0) {
      features.Attendance_Percentage = round2((100 * Number(a.present)) / Number(a.total));
      sources.Attendance_Percentage = "live";
    }

    const cs = coursesByStudent.get(r.student_id);
    if (cs && cs.length > 0) {
      const mean = (key) => round2(cs.reduce((sum, c) => sum + Number(c[key]), 0) / cs.length);
      features.Assignment_Avg = mean("assignment_avg");
      features.Quiz_Avg = mean("quiz_avg");
      features.Midterm_Marks = mean("midterm_marks");
      features.Final_Marks = mean("final_marks");
      Object.assign(sources, { Assignment_Avg: "live", Quiz_Avg: "live", Midterm_Marks: "live", Final_Marks: "live" });

      const credits = cs.reduce((sum, c) => sum + c.credit_hours, 0);
      features.SGPA = round2(cs.reduce((sum, c) => sum + c.credit_hours * coursePoints(c), 0) / credits);
      features.CGPA = round2((features.Previous_SGPA + features.SGPA) / 2);
      sources.SGPA = "provisional";
      sources.CGPA = "projected";
    }

    out.set(r.student_id, {
      features,
      sources,
      extra: {
        semester: r.semester,
        Warning_Count: r.warning_count,
        Consecutive_Low_CGPA: r.consecutive_low_cgpa,
      },
    });
  }
  return out;
}

/** buildFeatures(studentId) -> {features, sources, extra}, or null if the student has no performance row. */
async function buildFeatures(studentId, db = pool) {
  const built = await buildFeaturesMany([studentId], db);
  return built.get(Number(studentId)) || null;
}

module.exports = { buildFeatures, buildFeaturesMany, coursePoints };
