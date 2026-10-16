-- What caused each prediction, and which admin batch run (if any) produced it.
ALTER TABLE predictions
    ADD COLUMN triggered_by  VARCHAR(30),   -- e.g. 'student_refresh', 'faculty_result', 'faculty_attendance', 'admin_run'
    ADD COLUMN run_id        INTEGER REFERENCES prediction_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_predictions_run ON predictions (run_id) WHERE run_id IS NOT NULL;
