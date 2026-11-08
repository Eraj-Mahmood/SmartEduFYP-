-- Bug fix (2026-11 test pass): logout revokes the user's tokens.
-- POST /api/auth/logout sets it; middleware/auth.js rejects any token issued before it (401 TOKEN_REVOKED).
-- Tokens are not stored, so this signs the user out on every device, not just the one that logged out.
-- NULL = never logged out, so no token is rejected for this reason.
ALTER TABLE users ADD COLUMN sessions_revoked_at TIMESTAMPTZ;
