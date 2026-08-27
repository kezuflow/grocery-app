-- Staff & Access administration: staff invitations, optimistic-version
-- columns for staff identities and roles, and role lifecycle metadata.
-- Historical rows are preserved; defaults backfill existing records.

CREATE TABLE IF NOT EXISTS staff_invitation (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  invited_by_staff_id TEXT REFERENCES staff_identity(id),
  expires_at INTEGER NOT NULL,
  accepted_auth_user_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_invitation_status_idx ON staff_invitation(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_pending_email_unique
ON staff_invitation(email_normalized) WHERE status = 'PENDING';

ALTER TABLE staff_identity ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE role ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE role ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED'));
ALTER TABLE role ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
