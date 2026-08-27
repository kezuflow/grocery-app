-- Customer CRM: customer invitations and the privacy/closure request queue.
-- No hard-deletion surface exists; closure completion records resolution only.

CREATE TABLE IF NOT EXISTS customer_invitation (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  invited_by_staff_id TEXT REFERENCES staff_identity(id),
  expires_at INTEGER NOT NULL,
  accepted_customer_id TEXT REFERENCES customer(id),
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_invitation_status_idx
ON customer_invitation(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS customer_invitation_pending_email_unique
ON customer_invitation(email_normalized) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS privacy_request (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('ACCESS', 'CORRECTION', 'CLOSURE', 'ANONYMIZATION')),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'VERIFYING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'ESCALATED')),
  requested_at INTEGER NOT NULL,
  verified_at INTEGER,
  resolved_at INTEGER,
  assigned_staff_id TEXT REFERENCES staff_identity(id),
  reason TEXT,
  resolution TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS privacy_request_customer_idx
ON privacy_request(customer_id, status);
CREATE INDEX IF NOT EXISTS privacy_request_status_idx
ON privacy_request(status, requested_at);
