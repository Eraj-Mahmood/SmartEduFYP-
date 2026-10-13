-- ============================================================
-- Quick lookups for demo login credentials.
-- Paste any of these into pgAdmin4's Query Tool (on the `smartedu` database).
-- ============================================================

-- All faculty logins (password for all of them: Faculty@123)
SELECT u.email, f.full_name, d.name AS department, f.designation
FROM faculty f
JOIN users u ON u.user_id = f.user_id
JOIN departments d ON d.department_id = f.department_id
ORDER BY d.name, f.full_name;

-- A handful of enrolled students per department, with their roll number/email
-- (password for ALL imported students: Student@123, unless you overrode it)
SELECT s.roll_no, u.email, d.name AS department, s.full_name, s.cgpa
FROM students s
JOIN users u ON u.user_id = s.user_id
JOIN departments d ON d.department_id = s.department_id
WHERE s.student_id IN (
    SELECT DISTINCT student_id FROM enrollments
)
ORDER BY d.name, s.roll_no
LIMIT 20;

-- Every class (section) that now exists, with its assigned faculty
SELECT c.course_code, c.title, fc.section, f.full_name AS faculty,
       (SELECT COUNT(*) FROM enrollments e WHERE e.faculty_course_id = fc.faculty_course_id) AS enrolled
FROM faculty_courses fc
JOIN courses c ON c.course_id = fc.course_id
JOIN faculty f ON f.faculty_id = fc.faculty_id
ORDER BY c.course_code, fc.section;

-- Sanity check: row counts across the board
SELECT 'students' AS table_name, COUNT(*) FROM students
UNION ALL SELECT 'faculty', COUNT(*) FROM faculty
UNION ALL SELECT 'courses', COUNT(*) FROM courses
UNION ALL SELECT 'faculty_courses', COUNT(*) FROM faculty_courses
UNION ALL SELECT 'enrollments', COUNT(*) FROM enrollments
UNION ALL SELECT 'course_results', COUNT(*) FROM course_results
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance;
