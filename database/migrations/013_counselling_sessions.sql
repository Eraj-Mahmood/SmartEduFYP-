-- Phase 7, step 1: counselling sessions booked by the admin between a student and their counsellor.
-- Attendance is marked by the counsellor (or the admin) after the start time; nothing is ever marked
-- absent automatically. Sessions are never deleted through the API: they are cancelled instead.
CREATE TABLE counselling_sessions (
    session_id        SERIAL PRIMARY KEY,
    assignment_id     INTEGER REFERENCES counselor_assignments(id) ON DELETE SET NULL,
    student_id        INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    faculty_id        INTEGER NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,  -- the counsellor
    scheduled_at      TIMESTAMPTZ NOT NULL,
    duration_min      INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 15 AND 120),
    mode              VARCHAR(10) NOT NULL CHECK (mode IN ('in_person', 'online')),
    location          VARCHAR(300) NOT NULL,        -- e.g. "Room 204" or a meeting link
    agenda            VARCHAR(1000),
    reason            VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual', 'risk', 'probation')),
    status            VARCHAR(10) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
    attendance        VARCHAR(10) CHECK (attendance IN ('present', 'absent')),
    counsellor_notes  TEXT,                         -- private to faculty and admin, never shown to the student
    marked_by         INTEGER REFERENCES users(user_id),
    marked_at         TIMESTAMPTZ,
    cancelled_reason  VARCHAR(500),
    created_by        INTEGER REFERENCES users(user_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cs_attendance_marked_together CHECK ((attendance IS NULL) = (marked_at IS NULL)),
    CONSTRAINT cs_cancelled_not_marked CHECK (status <> 'cancelled' OR attendance IS NULL),
    CONSTRAINT cs_cancelled_has_reason CHECK ((status = 'cancelled') = (cancelled_reason IS NOT NULL))
);

CREATE INDEX idx_cs_faculty_time ON counselling_sessions (faculty_id, scheduled_at);
CREATE INDEX idx_cs_student_time ON counselling_sessions (student_id, scheduled_at);
