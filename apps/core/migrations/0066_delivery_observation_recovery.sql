-- Bounded recovery of verified but unapplied courier observations.
ALTER TABLE delivery_provider_event_inbox ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0);
ALTER TABLE delivery_provider_event_inbox ADD COLUMN next_recovery_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX delivery_provider_event_inbox_recovery_idx
  ON delivery_provider_event_inbox(processing_status, next_recovery_at, recovery_attempts, received_at, id);
