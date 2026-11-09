-- Phase 7.1 (Bugs 1 and 2): a semester close ends the term.
--
-- A close now records the term it closed as a completed-semester row for THAT semester (Previous_SGPA = the
-- term before, SGPA = the closed term, CGPA = the new official CGPA), next to the imported/live row for the
-- same semester. close_id marks those rows; the old rule "one row per (student, semester)" becomes "one
-- non-close row per (student, semester), and one row per (student, close)".
-- The enrolments of the closed term become 'completed' (that enum value has been in schema.sql since the start).
ALTER TABLE student_semester_performance ADD COLUMN close_id INTEGER REFERENCES semester_closes(id) ON DELETE CASCADE;
ALTER TABLE student_semester_performance DROP CONSTRAINT student_semester_performance_student_id_semester_key;
CREATE UNIQUE INDEX uq_performance_student_semester ON student_semester_performance (student_id, semester) WHERE close_id IS NULL;
CREATE UNIQUE INDEX uq_performance_student_close ON student_semester_performance (student_id, close_id) WHERE close_id IS NOT NULL;

-- Bug 2: a student already in the final semester of their programme is not moved past it at a close.
ALTER TABLE academic_standing ADD COLUMN final_semester_completed BOOLEAN NOT NULL DEFAULT FALSE;
