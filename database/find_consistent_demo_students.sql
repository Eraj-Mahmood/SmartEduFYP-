-- ============================================================
-- Find demo students whose data tells one consistent story.
-- Paste into pgAdmin4's Query Tool (on the `smartedu` database).
--
-- A student qualifies when ALL of these hold:
--   1. they have course_results (i.e. seed_demo_data.py enrolled them);
--   2. their average course grade agrees with their CGPA band:
--        grade points A=4, B=3, C=2, D=1, F=0, averaged over their courses,
--        must be within 0.5 of their CGPA (half a grade either way);
--   3. their dataset label (student_semester_performance.target_label, latest
--      semester) equals the model's latest prediction in `predictions`.
--
-- Condition 3 needs a prediction row: log in as the student and click
-- "Predict my outcome" (POST /api/student/prediction/refresh) first.
-- Query 1 lists candidates that pass 1+2 so you know whom to refresh.
-- ============================================================

-- Query 1: grade/CGPA-consistent candidates (conditions 1 + 2), with prediction if any
WITH course_grades AS (
    SELECT e.student_id,
           string_agg(cr.grade, ', ' ORDER BY c.course_code) AS grades,
           ROUND(AVG(CASE cr.grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2
                                   WHEN 'D' THEN 1 ELSE 0 END), 2) AS avg_grade_points
    FROM enrollments e
    JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
    JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
    JOIN courses c ON c.course_id = fc.course_id
    GROUP BY e.student_id
),
latest_perf AS (
    SELECT DISTINCT ON (student_id) student_id, cgpa, target_label
    FROM student_semester_performance
    ORDER BY student_id, semester DESC
),
latest_pred AS (
    SELECT DISTINCT ON (student_id) student_id, predicted_label
    FROM predictions
    ORDER BY student_id, created_at DESC
)
SELECT d.code AS department, s.roll_no, u.email, s.full_name,
       lp.cgpa, g.grades, g.avg_grade_points,
       lp.target_label AS dataset_label, pr.predicted_label AS model_label
FROM course_grades g
JOIN students s ON s.student_id = g.student_id
JOIN users u ON u.user_id = s.user_id
JOIN departments d ON d.department_id = s.department_id
JOIN latest_perf lp ON lp.student_id = g.student_id
LEFT JOIN latest_pred pr ON pr.student_id = g.student_id
WHERE ABS(g.avg_grade_points - lp.cgpa) <= 0.5
ORDER BY lp.target_label, d.code, lp.cgpa;

-- Query 2: fully consistent demo students (conditions 1 + 2 + 3), with the
-- faculty who teach them, so one faculty login can show all three labels
WITH course_grades AS (
    SELECT e.student_id,
           string_agg(cr.grade, ', ' ORDER BY c.course_code) AS grades,
           ROUND(AVG(CASE cr.grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2
                                   WHEN 'D' THEN 1 ELSE 0 END), 2) AS avg_grade_points
    FROM enrollments e
    JOIN course_results cr ON cr.enrollment_id = e.enrollment_id
    JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
    JOIN courses c ON c.course_id = fc.course_id
    GROUP BY e.student_id
),
latest_perf AS (
    SELECT DISTINCT ON (student_id) student_id, cgpa, target_label
    FROM student_semester_performance
    ORDER BY student_id, semester DESC
),
latest_pred AS (
    SELECT DISTINCT ON (student_id) student_id, predicted_label
    FROM predictions
    ORDER BY student_id, created_at DESC
),
teachers AS (
    SELECT e.student_id, string_agg(DISTINCT f.full_name, ', ') AS taught_by
    FROM enrollments e
    JOIN faculty_courses fc ON fc.faculty_course_id = e.faculty_course_id
    JOIN faculty f ON f.faculty_id = fc.faculty_id
    GROUP BY e.student_id
)
SELECT lp.target_label AS label, d.code AS department, s.roll_no, u.email, s.full_name,
       lp.cgpa, g.grades, g.avg_grade_points, t.taught_by
FROM course_grades g
JOIN students s ON s.student_id = g.student_id
JOIN users u ON u.user_id = s.user_id
JOIN departments d ON d.department_id = s.department_id
JOIN latest_perf lp ON lp.student_id = g.student_id
JOIN latest_pred pr ON pr.student_id = g.student_id
JOIN teachers t ON t.student_id = g.student_id
WHERE ABS(g.avg_grade_points - lp.cgpa) <= 0.5
  AND pr.predicted_label = lp.target_label
ORDER BY lp.target_label, d.code, lp.cgpa;
