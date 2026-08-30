-- Post-payment commitment failures must remain visible under stable,
-- operationally actionable categories. Rebuild the SQLite CHECK constraint to
-- retain legacy values and admit the complete current taxonomy.
ALTER TABLE finance_exception RENAME TO finance_exception_legacy;

CREATE TABLE finance_exception (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'QUOTE_EXPIRED',
    'QUOTE_ALREADY_CONSUMED',
    'MEMBERSHIP_LOST',
    'CYCLE_CLOSED',
    'CAPACITY_UNAVAILABLE',
    'CAPACITY_UNAVAILABLE_AFTER_PAYMENT',
    'INSTANT_MODE_UNAVAILABLE',
    'SOURCING_MODE_UNAVAILABLE',
    'STOCK_UNAVAILABLE',
    'TRANSIENT_FAILURE'
  )),
  payment_intent_id TEXT REFERENCES payment_intent(id),
  reaction_id TEXT,
  order_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

INSERT INTO finance_exception (
  id, kind, payment_intent_id, reaction_id, order_id, details_json, attempts,
  last_error_code, status, created_at, resolved_at
)
SELECT
  id, kind, payment_intent_id, reaction_id, order_id, details_json, attempts,
  last_error_code, status, created_at, resolved_at
FROM finance_exception_legacy;

DROP TABLE finance_exception_legacy;

CREATE INDEX finance_exception_open_idx ON finance_exception(status, created_at);
CREATE INDEX finance_exception_intent_idx ON finance_exception(payment_intent_id, status);
