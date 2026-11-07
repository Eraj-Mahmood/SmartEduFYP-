-- Phase 4, step 8: the admin audit-log viewer pages newest first and filters by actor/action/entity.
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC, log_id DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action);
CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id);
