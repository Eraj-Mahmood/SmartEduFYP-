-- Phase 4, step 4: a named academic counselor (a faculty member) per flagged student (FR12).
CREATE TABLE counselor_assignments (
    id                 SERIAL PRIMARY KEY,
    student_id         INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    faculty_id         INTEGER NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,
    prediction_id      INTEGER REFERENCES predictions(prediction_id) ON DELETE SET NULL,  -- the prediction that triggered it
    assigned_by        INTEGER REFERENCES users(user_id),
    status             VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    notes              TEXT,
    last_contacted_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at          TIMESTAMPTZ,
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- at most one active counselor per student
CREATE UNIQUE INDEX uq_counselor_active_student ON counselor_assignments (student_id) WHERE status = 'active';
-- "my counselees" and workload counts
CREATE INDEX idx_counselor_active_faculty ON counselor_assignments (faculty_id) WHERE status = 'active';

-- Where a notification click should take the recipient (an in-app path such as /faculty/counselees).
ALTER TABLE notifications ADD COLUMN link VARCHAR(300);
