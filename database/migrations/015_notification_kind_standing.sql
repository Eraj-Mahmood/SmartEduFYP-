-- Phase 7, step 5: notices about academic standing (semester close, warning letters) get their own kind.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('intervention', 'counselor', 'standing'));
