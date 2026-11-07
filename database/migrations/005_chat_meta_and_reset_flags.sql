-- Phase 4, step 1.
-- (a) Chat replies keep their suggestion chips, page links and intent, so a reloaded
--     conversation looks the same as the live one. NULL for the student's own messages.
ALTER TABLE chat_messages ADD COLUMN meta JSONB;

-- (b) Forced password change (enforced from Phase 4 step 7) is only for accounts an admin
--     creates in the app (POST /api/admin/users/student|faculty, which audit-log CREATE_STUDENT /
--     CREATE_FACULTY and set must_reset_pw = TRUE). Imported students, seeded faculty and the
--     createAdmin.js admin use the documented demo passwords and must not be blocked.
UPDATE users SET must_reset_pw = FALSE, updated_at = NOW()
WHERE must_reset_pw
  AND user_id NOT IN (
    SELECT s.user_id FROM audit_log a JOIN students s ON s.student_id = a.entity_id
    WHERE a.action = 'CREATE_STUDENT'
    UNION
    SELECT f.user_id FROM audit_log a JOIN faculty f ON f.faculty_id = a.entity_id
    WHERE a.action = 'CREATE_FACULTY'
  );
