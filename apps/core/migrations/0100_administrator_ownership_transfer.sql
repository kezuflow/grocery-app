-- Immutable evidence for the explicitly authorized one-time retirement of a
-- retained synthetic administrator and transfer to a verified production
-- identity. The retired auth/staff rows remain as restricted audit anchors.
CREATE TABLE administrator_ownership_transfer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  source_staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE RESTRICT,
  target_auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  target_staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE RESTRICT,
  role_id TEXT NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  source_email_hash TEXT NOT NULL CHECK (length(source_email_hash) = 64),
  target_email_hash TEXT NOT NULL CHECK (length(target_email_hash) = 64),
  capability_codes_json TEXT NOT NULL CHECK (json_valid(capability_codes_json)),
  revoked_session_count INTEGER NOT NULL CHECK (revoked_session_count >= 0),
  removed_account_count INTEGER NOT NULL CHECK (removed_account_count >= 0),
  completed_at INTEGER NOT NULL CHECK (completed_at BETWEEN 0 AND 9007199254740991)
) STRICT;

CREATE TRIGGER administrator_ownership_transfer_immutable_update
BEFORE UPDATE ON administrator_ownership_transfer
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ADMINISTRATOR_OWNERSHIP_TRANSFER'); END;

CREATE TRIGGER administrator_ownership_transfer_immutable_delete
BEFORE DELETE ON administrator_ownership_transfer
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ADMINISTRATOR_OWNERSHIP_TRANSFER'); END;
