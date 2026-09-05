-- Complete the persistence seams needed for canonical refund processing,
-- Cloudflare Queue publication/lease recovery, and public historical Order
-- identity. Compatibility refund/fleet/mock records are not deleted.

ALTER TABLE payment_refund ADD COLUMN canonical_status TEXT
  CHECK (
    canonical_status IS NULL OR
    canonical_status IN ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'ESCALATED')
  );
ALTER TABLE payment_refund ADD COLUMN reason_code TEXT;
ALTER TABLE payment_refund ADD COLUMN requested_by_staff_id TEXT
  REFERENCES staff_identity(id);
ALTER TABLE payment_refund ADD COLUMN processing_started_at INTEGER;
ALTER TABLE payment_refund ADD COLUMN provider_observed_at INTEGER;
ALTER TABLE payment_refund ADD COLUMN next_retry_at INTEGER;
ALTER TABLE payment_refund ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (attempt_count >= 0);
ALTER TABLE payment_refund ADD COLUMN last_error_code TEXT;
ALTER TABLE payment_refund ADD COLUMN reconciliation_case_id TEXT
  REFERENCES payment_reconciliation_case(id);

UPDATE payment_refund
SET canonical_status = CASE status
  WHEN 'APPROVED' THEN 'PROCESSING'
  WHEN 'REJECTED' THEN 'FAILED'
  ELSE status
END
WHERE canonical_status IS NULL;

CREATE INDEX payment_refund_processing_idx
  ON payment_refund(status, next_retry_at, updated_at, id);
CREATE UNIQUE INDEX payment_refund_reconciliation_case_unique
  ON payment_refund(reconciliation_case_id)
  WHERE reconciliation_case_id IS NOT NULL;

ALTER TABLE notification_outbox
  ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (
    publication_status IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED')
  );
ALTER TABLE notification_outbox ADD COLUMN queue_message_id TEXT;
ALTER TABLE notification_outbox
  ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (publication_attempts >= 0);
ALTER TABLE notification_outbox ADD COLUMN published_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN lease_owner TEXT;
ALTER TABLE notification_outbox ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN dead_lettered_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN processed_at INTEGER;

CREATE INDEX notification_outbox_publication_due_idx
  ON notification_outbox(publication_status, available_at, scheduled_at, id);
CREATE INDEX notification_outbox_expired_lease_idx
  ON notification_outbox(publication_status, lease_expires_at, id);
CREATE UNIQUE INDEX notification_outbox_queue_message_unique
  ON notification_outbox(queue_message_id)
  WHERE queue_message_id IS NOT NULL;

CREATE TRIGGER notification_outbox_queue_state_insert_guard
BEFORE INSERT ON notification_outbox
WHEN
  (NEW.publication_status = 'PUBLISHED'
   AND (NEW.queue_message_id IS NULL OR NEW.published_at IS NULL))
  OR (NEW.publication_status = 'DEAD_LETTERED' AND NEW.dead_lettered_at IS NULL)
  OR ((NEW.lease_owner IS NULL) != (NEW.lease_expires_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_NOTIFICATION_QUEUE_STATE');
END;

CREATE TRIGGER notification_outbox_queue_state_update_guard
BEFORE UPDATE OF publication_status, queue_message_id, published_at, lease_owner,
  lease_expires_at, dead_lettered_at
ON notification_outbox
WHEN
  (NEW.publication_status = 'PUBLISHED'
   AND (NEW.queue_message_id IS NULL OR NEW.published_at IS NULL))
  OR (NEW.publication_status = 'DEAD_LETTERED' AND NEW.dead_lettered_at IS NULL)
  OR ((NEW.lease_owner IS NULL) != (NEW.lease_expires_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_NOTIFICATION_QUEUE_STATE');
END;

-- Deterministic and injective for every historical internal Order id. The full
-- hexadecimal representation avoids collision-prone truncation or dependence
-- on mutable row ordering. Existing public numbers remain unchanged.
UPDATE grocery_order
SET order_number = 'FM-HIST-' || UPPER(HEX(id))
WHERE order_number IS NULL;
