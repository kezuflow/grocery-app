-- Order issue intake queue: customer-reported order problems worked by staff.
-- Issue actions never authorize refunds; resolution is operational record only.

CREATE TABLE IF NOT EXISTS order_issue (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  customer_id TEXT NOT NULL REFERENCES customer(id),
  category TEXT NOT NULL CHECK (category IN ('MISSING_ITEM','WRONG_ITEM','DAMAGED','QUALITY','QUANTITY','DELIVERY','OTHER')),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','CLAIMED','INVESTIGATING','RESOLVED','ESCALATED')),
  details TEXT,
  assigned_staff_id TEXT REFERENCES staff_identity(id),
  resolution TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS order_issue_status_idx ON order_issue(status, created_at);
CREATE INDEX IF NOT EXISTS order_issue_order_idx ON order_issue(order_id);
