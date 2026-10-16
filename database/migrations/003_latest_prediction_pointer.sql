-- Pointer to each student's newest prediction, so "latest prediction per student" is a plain
-- join instead of a DISTINCT ON over the whole predictions table.
-- predictionService.js updates it in the same transaction as every insert.
ALTER TABLE students
    ADD COLUMN latest_prediction_id INTEGER REFERENCES predictions(prediction_id) ON DELETE SET NULL;

UPDATE students s SET latest_prediction_id = l.prediction_id
FROM (
    SELECT DISTINCT ON (student_id) student_id, prediction_id
    FROM predictions
    ORDER BY student_id, created_at DESC, prediction_id DESC
) l
WHERE l.student_id = s.student_id;

CREATE INDEX idx_students_latest_prediction ON students (latest_prediction_id);
