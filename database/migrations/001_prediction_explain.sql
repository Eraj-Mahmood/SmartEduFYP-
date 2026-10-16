-- Phase 1: explainable, policy-checked predictions built from live data.

-- ------------------------------------------------------------
-- predictions: model vs policy vs final label, SHAP drivers, the exact inputs used
-- ------------------------------------------------------------
ALTER TABLE predictions
    ADD COLUMN model_label      risk_label,     -- what the model (or rule fallback) said
    ADD COLUMN policy_label     risk_label,     -- what the institutional policy says (NULL = no rule fired)
    ADD COLUMN final_label      risk_label,     -- more severe of model_label and policy_label
    ADD COLUMN policy_reason    TEXT,
    ADD COLUMN drivers          JSONB,          -- SHAP top-5 [{feature, value, shap, direction}]; NULL for fallback
    ADD COLUMN reasons          JSONB,          -- plain-language sentences shown to the student
    ADD COLUMN features         JSONB,          -- the exact 20 inputs sent to the model
    ADD COLUMN feature_sources  JSONB,          -- which features were overridden from live data, e.g. {"Quiz_Avg": "live"}
    ADD COLUMN source           VARCHAR(10) NOT NULL DEFAULT 'model'
        CHECK (source IN ('model', 'fallback'));

-- predicted_label is kept for compatibility; for every row it equals final_label.
UPDATE predictions
SET model_label = predicted_label,
    final_label = predicted_label,
    source = CASE WHEN model_version = 'rule_fallback' THEN 'fallback' ELSE 'model' END;

ALTER TABLE predictions
    ALTER COLUMN model_label SET NOT NULL,
    ALTER COLUMN final_label SET NOT NULL;

-- "Latest prediction per student": DISTINCT ON (student_id) ... ORDER BY student_id, created_at DESC, prediction_id DESC
DROP INDEX IF EXISTS idx_predictions_student;
CREATE INDEX idx_predictions_student_latest ON predictions (student_id, created_at DESC, prediction_id DESC);

-- ------------------------------------------------------------
-- Where academic rows came from: the imported/seeded dataset or faculty entry in the app
-- ------------------------------------------------------------
ALTER TABLE course_results
    ADD COLUMN data_source VARCHAR(10) NOT NULL DEFAULT 'synthetic' CHECK (data_source IN ('synthetic', 'live'));
ALTER TABLE attendance
    ADD COLUMN data_source VARCHAR(10) NOT NULL DEFAULT 'synthetic' CHECK (data_source IN ('synthetic', 'live'));
ALTER TABLE student_semester_performance
    ADD COLUMN data_source VARCHAR(10) NOT NULL DEFAULT 'synthetic' CHECK (data_source IN ('synthetic', 'live'));

-- ------------------------------------------------------------
-- prediction_runs: admin batch re-prediction jobs (one student, a class, a department or all)
-- ------------------------------------------------------------
CREATE TABLE prediction_runs (
    id            SERIAL PRIMARY KEY,
    scope         VARCHAR(20) NOT NULL CHECK (scope IN ('all', 'department', 'class', 'student')),
    scope_id      INTEGER,
    total         INTEGER NOT NULL DEFAULT 0,
    done          INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    started_by    INTEGER REFERENCES users(user_id),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    error         TEXT
);
