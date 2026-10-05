-- A provider claim action is private to the authenticated refund owner.
ALTER TABLE payment_refund ADD COLUMN claim_url TEXT CHECK (claim_url IS NULL OR length(claim_url) <= 2048);
ALTER TABLE payment_refund ADD COLUMN claim_expires_at INTEGER CHECK (
  (claim_url IS NULL AND claim_expires_at IS NULL) OR
  (claim_url IS NOT NULL AND claim_expires_at BETWEEN 0 AND 9007199254740991)
);
