-- An explicitly reviewed retry window never rewrites original receipt evidence.
ALTER TABLE payment_provider_event_inbox ADD COLUMN recovery_started_at INTEGER
  CHECK (recovery_started_at IS NULL OR recovery_started_at BETWEEN -9007199254740991 AND 9007199254740991);
