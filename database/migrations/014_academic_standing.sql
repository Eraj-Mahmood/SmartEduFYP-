-- Phase 7, step 4: academic standing under the BU Student Handbook (Spring 2024), clause 5.5.
-- The rules (minimum CGPA per programme, probations before drop) are in
-- backend/src/config/academicStanding.json; this file only stores the outcomes.
-- Probation never changes the ML risk label: the two are shown side by side.

-- One row per "Close semester" run by the admin (Step 5).
CREATE TABLE semester_closes (
    id                SERIAL PRIMARY KEY,
    term_label        VARCHAR(40) NOT NULL,
    closed_by         INTEGER REFERENCES users(user_id),
    closed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    students_total    INTEGER NOT NULL DEFAULT 0,
    good_count        INTEGER NOT NULL DEFAULT 0,
    probation_1_count INTEGER NOT NULL DEFAULT 0,
    probation_2_count INTEGER NOT NULL DEFAULT 0,
    dropped_count     INTEGER NOT NULL DEFAULT 0,
    not_evaluated_count INTEGER NOT NULL DEFAULT 0
);

-- Every standing decision, newest last. source 'seed' = the starting status set by demo:reset,
-- 'close' = decided at a semester close (close_id set).
CREATE TABLE academic_standing (
    id               SERIAL PRIMARY KEY,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    close_id         INTEGER REFERENCES semester_closes(id) ON DELETE CASCADE,
    semester_no      INTEGER,
    cgpa_used        NUMERIC(3,2),
    status           VARCHAR(15) NOT NULL CHECK (status IN ('good', 'probation_1', 'probation_2', 'dropped', 'not_evaluated')),
    probation_count  INTEGER NOT NULL DEFAULT 0 CHECK (probation_count BETWEEN 0 AND 2),
    source           VARCHAR(10) NOT NULL CHECK (source IN ('seed', 'close')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((source = 'close') = (close_id IS NOT NULL))
);
CREATE INDEX idx_standing_student ON academic_standing (student_id, id DESC);
CREATE INDEX idx_standing_close ON academic_standing (close_id);

-- 5.5.2: a formal warning letter after each probation, acknowledged by the student.
CREATE TABLE warning_letters (
    id               SERIAL PRIMARY KEY,
    standing_id      INTEGER NOT NULL UNIQUE REFERENCES academic_standing(id) ON DELETE CASCADE,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    level            INTEGER NOT NULL CHECK (level IN (1, 2)),
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    issued_by        INTEGER REFERENCES users(user_id),
    acknowledged_at  TIMESTAMPTZ
);
CREATE INDEX idx_letters_student ON warning_letters (student_id);

-- 5.5.5: the Principal's prior approval (through the HoD) for a student on the 2nd probation to enrol.
-- Recorded by the admin, who types the approver's role (there are no HoD or Principal accounts).
CREATE TABLE enrolment_approvals (
    id             SERIAL PRIMARY KEY,
    standing_id    INTEGER NOT NULL REFERENCES academic_standing(id) ON DELETE CASCADE,
    student_id     INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    approved_by    INTEGER REFERENCES users(user_id),
    approver_role  VARCHAR(100) NOT NULL,
    note           VARCHAR(1000),
    approved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_approvals_standing ON enrolment_approvals (standing_id);

-- Kept in step with the student's latest academic_standing row (services/academicStanding.js).
ALTER TABLE students
    ADD COLUMN academic_status VARCHAR(15) NOT NULL DEFAULT 'not_evaluated'
        CHECK (academic_status IN ('good', 'probation_1', 'probation_2', 'dropped', 'not_evaluated')),
    ADD COLUMN probation_count INTEGER NOT NULL DEFAULT 0 CHECK (probation_count BETWEEN 0 AND 2);
CREATE INDEX idx_students_academic_status ON students (academic_status);
