-- One Orders-owned cancellation aggregate coordinates every Payments-owned
-- refund required to close an order. Operational acceptance and financial
-- completion remain distinct, replay-safe phases.

CREATE TABLE order_cancellation (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES grocery_order(id),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('CUSTOMER','BUSINESS','STAFF_EXCEPTION')),
  cause TEXT NOT NULL CHECK (cause IN (
    'CUSTOMER_REQUEST','STOCK_UNAVAILABLE','OPERATIONAL_FAILURE',
    'FAILED_DELIVERY','DUPLICATE_CHARGE','DAMAGED_GOODS','OTHER'
  )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status TEXT NOT NULL
    CHECK (status IN ('REQUESTED','REFUNDS_PROCESSING','COMPLETED','EXCEPTION')),
  retained_service_fee_minor INTEGER NOT NULL
    CHECK (retained_service_fee_minor >= 0),
  required_refund_minor INTEGER NOT NULL CHECK (required_refund_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX order_cancellation_status_idx
  ON order_cancellation(status, updated_at, id);

CREATE TABLE order_cancellation_refund_member (
  id TEXT PRIMARY KEY,
  cancellation_id TEXT NOT NULL REFERENCES order_cancellation(id) ON DELETE CASCADE,
  payment_intent_id TEXT NOT NULL REFERENCES payment_intent(id),
  required_amount_minor INTEGER NOT NULL CHECK (required_amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  refund_id TEXT REFERENCES payment_refund(id),
  status TEXT NOT NULL CHECK (status IN (
    'NOT_REQUESTED','REQUESTED','APPROVED','PROCESSING','SUCCEEDED',
    'REJECTED','FAILED','ESCALATED'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX order_cancellation_refund_member_payment_unique
  ON order_cancellation_refund_member(cancellation_id, payment_intent_id);
CREATE UNIQUE INDEX order_cancellation_refund_member_refund_unique
  ON order_cancellation_refund_member(refund_id)
  WHERE refund_id IS NOT NULL;
CREATE INDEX order_cancellation_refund_member_due_idx
  ON order_cancellation_refund_member(status, updated_at, cancellation_id);
