-- Immutable provider-neutral settlement evidence derived only from verified
-- provider events. Processing cost is distinct from customer-facing charges.

CREATE TABLE payment_settlement_observation (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL REFERENCES payment_intent(id),
  gross_minor INTEGER NOT NULL CHECK (gross_minor >= 0),
  processing_cost_minor INTEGER NOT NULL CHECK (processing_cost_minor >= 0),
  withholding_minor INTEGER NOT NULL CHECK (withholding_minor >= 0),
  adjustment_minor INTEGER NOT NULL CHECK (adjustment_minor >= 0),
  net_minor INTEGER NOT NULL CHECK (net_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (
    net_minor = gross_minor - processing_cost_minor - withholding_minor + adjustment_minor
  ),
  UNIQUE(provider, provider_event_id, payment_intent_id)
);

CREATE INDEX payment_settlement_observation_intent_idx
  ON payment_settlement_observation(payment_intent_id, observed_at, id);
