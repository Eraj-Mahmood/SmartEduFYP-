-- Phase 5, steps 4-7: bulk uploads of results / attendance (faculty, FR13) and live cohort imports
-- (admin). Every upload request is logged here: a preview (validated, nothing written), a commit
-- (good rows written with data_source = 'live'), or a failed commit (no good rows / error).
CREATE TABLE uploads (
    id                 SERIAL PRIMARY KEY,
    -- the class the file is for; NULL only until a cohort import has created its class
    faculty_course_id  INTEGER REFERENCES faculty_courses(faculty_course_id) ON DELETE SET NULL,
    uploaded_by        INTEGER NOT NULL REFERENCES users(user_id),
    kind               VARCHAR(12) NOT NULL CHECK (kind IN ('results', 'attendance', 'cohort')),
    filename           VARCHAR(255) NOT NULL,
    rows_total         INTEGER NOT NULL DEFAULT 0,
    rows_ok            INTEGER NOT NULL DEFAULT 0,
    rows_failed        INTEGER NOT NULL DEFAULT 0,
    errors             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{row, column, message, roll_no}]
    summary            JSONB,                                -- skipped rows, re-predicted, labels changed, ...
    status             VARCHAR(12) NOT NULL CHECK (status IN ('previewed', 'committed', 'failed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at       TIMESTAMPTZ
);
CREATE INDEX idx_uploads_uploader ON uploads (uploaded_by, created_at DESC);
CREATE INDEX idx_uploads_class ON uploads (faculty_course_id);

-- Which upload wrote a row (NULL = typed in the app or seeded).
ALTER TABLE course_results ADD COLUMN upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL;
ALTER TABLE student_semester_performance ADD COLUMN upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL;

-- Students created by a live cohort import are 'live'; everyone imported from the dataset is 'synthetic'.
ALTER TABLE students ADD COLUMN data_source VARCHAR(10) NOT NULL DEFAULT 'synthetic'
    CHECK (data_source IN ('synthetic', 'live'));
-- the institution's recorded outcome for a live student, when the cohort file has one
ALTER TABLE students ADD COLUMN actual_outcome VARCHAR(10)
    CHECK (actual_outcome IN ('safe', 'at_risk', 'dropout', 'unknown'));
CREATE INDEX idx_students_data_source ON students (data_source) WHERE data_source = 'live';
