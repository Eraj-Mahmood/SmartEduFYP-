-- Phase 4, step 2: study material per course (FR11). Seeded by backend/src/scripts/seedTutorials.js,
-- which checks every URL over HTTP and stores is_active = FALSE for any it can't reach.
-- Admins manage them under /api/admin/tutorials.
CREATE TABLE tutorials (
    tutorial_id  SERIAL PRIMARY KEY,
    course_id    INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL,
    url          VARCHAR(500) NOT NULL CHECK (url ~ '^https?://'),
    provider     VARCHAR(100),
    kind         VARCHAR(10) NOT NULL CHECK (kind IN ('video', 'notes', 'practice')),
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   INTEGER REFERENCES users(user_id),   -- NULL for seeded rows
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, url)
);

CREATE INDEX idx_tutorials_course ON tutorials (course_id);
