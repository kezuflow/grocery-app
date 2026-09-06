-- Stable operator idempotency evidence for external delivery creation.
-- Historical internal assignments remain readable, but new provider claims
-- are mutually exclusive with batch/Rider assignment at the database edge.

ALTER TABLE delivery_provider_dispatch
  ADD COLUMN client_idempotency_key TEXT;

CREATE UNIQUE INDEX delivery_provider_dispatch_client_key_unique
  ON delivery_provider_dispatch(client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE TRIGGER delivery_provider_dispatch_external_only_insert_guard
BEFORE INSERT ON delivery_provider_dispatch
WHEN EXISTS (
  SELECT 1 FROM delivery_job
  WHERE id=NEW.delivery_job_id AND (batch_id IS NOT NULL OR rider_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'DELIVERY_ALREADY_ASSIGNED_INTERNAL');
END;
