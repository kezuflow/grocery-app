-- Read-only provider lookup scheduling is separate from canonical financial state.
-- Existing payment identities, versions and observations remain unchanged.
CREATE TABLE payment_lookup_recovery (
  payment_intent_id TEXT PRIMARY KEY NOT NULL REFERENCES payment_intent(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','EXHAUSTED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempts)='integer' AND attempts BETWEEN 0 AND 9007199254740991),
  available_at INTEGER NOT NULL CHECK (typeof(available_at)='integer' AND available_at BETWEEN -9007199254740991 AND 9007199254740991),
  lease_token TEXT,
  last_error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN -9007199254740991 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;
CREATE INDEX payment_lookup_recovery_due_idx ON payment_lookup_recovery(status,available_at,payment_intent_id);
CREATE INDEX payment_intent_recovery_due_idx ON payment_intent(status,updated_at,id);
