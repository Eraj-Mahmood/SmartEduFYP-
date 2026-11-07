-- Phase 4, step 5: interventions can carry the recommended tutorial.
ALTER TABLE notifications
    ADD COLUMN related_tutorial_id INTEGER REFERENCES tutorials(tutorial_id) ON DELETE SET NULL,
    -- 'intervention' (an admin's message to a student) or 'counselor' (the automatic assignment
    -- notices); NULL for older rows, which were all interventions
    ADD COLUMN kind VARCHAR(20) CHECK (kind IN ('intervention', 'counselor'));

UPDATE notifications SET kind = 'counselor' WHERE subject IN ('Your academic counselor', 'New counselee');

-- "last intervention" per student
CREATE INDEX idx_notifications_recipient_sent ON notifications (recipient_user_id, sent_at DESC);
