-- Preserve retained financial case evidence while fencing concurrent review/reopen commands.
ALTER TABLE payment_reconciliation_case ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version BETWEEN 1 AND 9007199254740991);
