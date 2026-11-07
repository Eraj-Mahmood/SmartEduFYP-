-- Phase 5, step 1: tokens issued before a password change stop working.
-- NULL = never changed through the app, so no token is rejected for this reason.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
