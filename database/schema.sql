-- ============================================================
-- SmartEdu: Predictive Analytics for Student Performance/Retention
-- PostgreSQL Schema
-- ============================================================

CREATE TYPE user_role AS ENUM ('student', 'faculty', 'admin');
CREATE TYPE enrollment_status AS ENUM ('enrolled', 'dropped', 'completed');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'leave');
CREATE TYPE risk_label AS ENUM ('Safe', 'At-Risk', 'Dropout-Likely');
CREATE TYPE yes_no AS ENUM ('Yes', 'No');

-- ------------------------------------------------------------
-- USERS  (single login table for all 3 roles -> role-based redirect)
-- ------------------------------------------------------------
CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    email           VARCHAR(150) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    must_reset_pw   BOOLEAN NOT NULL DEFAULT TRUE,   -- admin-issued creds
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- DEPARTMENTS
-- ------------------------------------------------------------
CREATE TABLE departments (
    department_id   SERIAL PRIMARY KEY,
    code            VARCHAR(20) UNIQUE NOT NULL,   -- CS, EE, SE, AI, Business
    name            VARCHAR(100) NOT NULL
);

-- ------------------------------------------------------------
-- STUDENTS
-- ------------------------------------------------------------
CREATE TABLE students (
    student_id        SERIAL PRIMARY KEY,
    user_id           INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    roll_no           VARCHAR(30) UNIQUE NOT NULL,
    full_name         VARCHAR(150) NOT NULL,
    department_id     INTEGER NOT NULL REFERENCES departments(department_id),
    gender            VARCHAR(20),
    age               INTEGER,
    current_semester  INTEGER NOT NULL DEFAULT 1,
    cgpa              NUMERIC(3,2) DEFAULT 0,
    scholarship       yes_no DEFAULT 'No',
    hostel            yes_no DEFAULT 'No',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- FACULTY
-- ------------------------------------------------------------
CREATE TABLE faculty (
    faculty_id        SERIAL PRIMARY KEY,
    user_id           INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    employee_no       VARCHAR(30) UNIQUE NOT NULL,
    full_name         VARCHAR(150) NOT NULL,
    department_id     INTEGER NOT NULL REFERENCES departments(department_id),
    designation       VARCHAR(100),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- COURSES
-- ------------------------------------------------------------
CREATE TABLE courses (
    course_id       SERIAL PRIMARY KEY,
    course_code     VARCHAR(20) UNIQUE NOT NULL,
    title           VARCHAR(150) NOT NULL,
    department_id   INTEGER NOT NULL REFERENCES departments(department_id),
    credit_hours    INTEGER NOT NULL DEFAULT 3
);

-- ------------------------------------------------------------
-- FACULTY_COURSES (faculty teaches many subjects & many class sections)
-- ------------------------------------------------------------
CREATE TABLE faculty_courses (
    faculty_course_id  SERIAL PRIMARY KEY,
    faculty_id         INTEGER NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,
    course_id          INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    section            VARCHAR(10) NOT NULL DEFAULT 'A',
    semester           INTEGER NOT NULL,
    academic_year      VARCHAR(9) NOT NULL,          -- e.g. '2025-2026'
    assigned_by        INTEGER REFERENCES users(user_id),   -- admin who assigned
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (faculty_id, course_id, section, semester, academic_year)
);

-- ------------------------------------------------------------
-- ENROLLMENTS (student <-> faculty_course, i.e. a specific class)
-- ------------------------------------------------------------
CREATE TABLE enrollments (
    enrollment_id      SERIAL PRIMARY KEY,
    student_id         INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    faculty_course_id  INTEGER NOT NULL REFERENCES faculty_courses(faculty_course_id) ON DELETE CASCADE,
    status             enrollment_status NOT NULL DEFAULT 'enrolled',
    enrolled_by        INTEGER REFERENCES users(user_id),   -- admin (course assign/drop)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, faculty_course_id)
);

-- ------------------------------------------------------------
-- COURSE_RESULTS (faculty read/write per class)
-- ------------------------------------------------------------
CREATE TABLE course_results (
    result_id          SERIAL PRIMARY KEY,
    enrollment_id      INTEGER UNIQUE NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
    assignment_avg     NUMERIC(5,2) DEFAULT 0,
    quiz_avg           NUMERIC(5,2) DEFAULT 0,
    midterm_marks      NUMERIC(5,2) DEFAULT 0,
    final_marks        NUMERIC(5,2) DEFAULT 0,
    grade              VARCHAR(3),
    updated_by         INTEGER REFERENCES users(user_id),   -- faculty who entered/edited
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ATTENDANCE (faculty read/write per class per date)
-- ------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id     SERIAL PRIMARY KEY,
    enrollment_id     INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
    class_date        DATE NOT NULL,
    status            attendance_status NOT NULL,
    marked_by         INTEGER REFERENCES users(user_id),
    marked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (enrollment_id, class_date)
);

-- ------------------------------------------------------------
-- STUDENT_SEMESTER_PERFORMANCE
-- One row per student per semester -> this is what the 50k-row
-- synthetic CSV loads into, and what feeds the ML model + the
-- student's read-only "results / CGPA / attendance" view.
-- ------------------------------------------------------------
CREATE TABLE student_semester_performance (
    performance_id              SERIAL PRIMARY KEY,
    student_id                  INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester                    INTEGER NOT NULL,
    attendance_percentage       NUMERIC(5,2),
    assignment_avg              NUMERIC(5,2),
    quiz_avg                    NUMERIC(5,2),
    midterm_marks               NUMERIC(5,2),
    final_marks                 NUMERIC(5,2),
    study_hours_per_week        NUMERIC(5,2),
    lms_login_count             INTEGER,
    assignment_submission_rate  NUMERIC(5,2),
    previous_sgpa               NUMERIC(3,2),
    sgpa                        NUMERIC(3,2),
    cgpa                        NUMERIC(3,2),
    consecutive_low_cgpa        INTEGER DEFAULT 0,
    failed_courses              INTEGER DEFAULT 0,
    credits_enrolled            INTEGER,
    credits_passed              INTEGER,
    warning_count                INTEGER DEFAULT 0,
    target_label                 risk_label,     -- ground-truth / latest known label
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, semester)
);

-- ------------------------------------------------------------
-- PREDICTIONS  (output of the Random Forest "helper bot")
-- ------------------------------------------------------------
CREATE TABLE predictions (
    prediction_id     SERIAL PRIMARY KEY,
    student_id        INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester          INTEGER NOT NULL,
    predicted_label   risk_label NOT NULL,
    prob_safe         NUMERIC(5,4),
    prob_at_risk      NUMERIC(5,4),
    prob_dropout      NUMERIC(5,4),
    model_version     VARCHAR(50) DEFAULT 'rf_v1',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- NOTIFICATIONS (admin -> student / faculty interventions)
-- ------------------------------------------------------------
CREATE TABLE notifications (
    notification_id        SERIAL PRIMARY KEY,
    sender_admin_id         INTEGER NOT NULL REFERENCES users(user_id),
    recipient_user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    related_prediction_id   INTEGER REFERENCES predictions(prediction_id),
    subject                  VARCHAR(200) NOT NULL,
    message                  TEXT NOT NULL,
    sent_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at                   TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- AUDIT LOG (who changed what — useful for FYP viva + accountability)
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    log_id          SERIAL PRIMARY KEY,
    actor_user_id   INTEGER REFERENCES users(user_id),
    action          VARCHAR(100) NOT NULL,   -- e.g. 'UPDATE_RESULT', 'MARK_ATTENDANCE', 'ASSIGN_FACULTY'
    entity          VARCHAR(100) NOT NULL,   -- table name
    entity_id       INTEGER,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Indexes for common lookups
-- ------------------------------------------------------------
CREATE INDEX idx_students_department ON students(department_id);
CREATE INDEX idx_faculty_department ON faculty(department_id);
CREATE INDEX idx_faculty_courses_faculty ON faculty_courses(faculty_id);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_faculty_course ON enrollments(faculty_course_id);
CREATE INDEX idx_attendance_enrollment ON attendance(enrollment_id);
CREATE INDEX idx_perf_student ON student_semester_performance(student_id);
CREATE INDEX idx_predictions_student ON predictions(student_id);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id);

-- ------------------------------------------------------------
-- Seed departments (matches dataset)
-- ------------------------------------------------------------
INSERT INTO departments (code, name) VALUES
    ('CS', 'Computer Science'),
    ('SE', 'Software Engineering'),
    ('EE', 'Electrical Engineering'),
    ('AI', 'Artificial Intelligence'),
    ('Business', 'Business Administration');

-- ------------------------------------------------------------
-- Seed one admin so you can log in on day one.
-- Generate the real hash with: node backend/scripts/hashPassword.js "YourPassword"
-- and paste it below before running this file.
-- ------------------------------------------------------------
-- INSERT INTO users (email, password_hash, role, must_reset_pw)
-- VALUES ('admin@smartedu.edu', '<PASTE_BCRYPT_HASH_HERE>', 'admin', FALSE);
