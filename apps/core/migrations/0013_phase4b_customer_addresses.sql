-- Phase 4B: support owner-scoped address reads and versioned updates.
CREATE INDEX IF NOT EXISTS customer_address_owner_status_updated_idx
  ON customer_address(customer_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_address_owner_version_idx
  ON customer_address(customer_id, id, version);
