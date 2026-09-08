-- Private provider creation evidence permits local adoption without another external create.
CREATE TABLE payment_creation_observation (
  payment_intent_id TEXT NOT NULL PRIMARY KEY REFERENCES payment_intent(id),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL CHECK (length(provider_reference)>0),
  purpose TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('NONE','REDIRECT','SDK')),
  redirect_url TEXT,
  client_token TEXT,
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at BETWEEN -9007199254740991 AND 9007199254740991),
  observed_at INTEGER NOT NULL CHECK (observed_at BETWEEN -9007199254740991 AND 9007199254740991),
  applied_at INTEGER CHECK (applied_at IS NULL OR applied_at BETWEEN -9007199254740991 AND 9007199254740991),
  UNIQUE(provider,provider_reference)
) STRICT;
CREATE TRIGGER payment_creation_observation_immutable BEFORE UPDATE ON payment_creation_observation
WHEN NEW.payment_intent_id IS NOT OLD.payment_intent_id OR NEW.provider IS NOT OLD.provider
  OR NEW.provider_reference IS NOT OLD.provider_reference OR NEW.purpose IS NOT OLD.purpose
  OR NEW.subject_type IS NOT OLD.subject_type OR NEW.subject_id IS NOT OLD.subject_id
  OR NEW.customer_id IS NOT OLD.customer_id OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.currency IS NOT OLD.currency OR NEW.action_type IS NOT OLD.action_type
  OR NEW.redirect_url IS NOT OLD.redirect_url OR NEW.client_token IS NOT OLD.client_token
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.observed_at IS NOT OLD.observed_at
  OR (OLD.applied_at IS NOT NULL AND NEW.applied_at IS NOT OLD.applied_at)
BEGIN SELECT RAISE(ABORT,'payment creation evidence is immutable'); END;
CREATE TRIGGER payment_creation_observation_delete BEFORE DELETE ON payment_creation_observation
BEGIN SELECT RAISE(ABORT,'payment creation evidence is immutable'); END;
