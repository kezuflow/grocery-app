-- Provider facts and internal recovery state; paid Order snapshots are untouched.
ALTER TABLE delivery_provider_dispatch ADD COLUMN driver_observed_at INTEGER
  CHECK (driver_observed_at IS NULL OR driver_observed_at BETWEEN 0 AND 9007199254740991);
ALTER TABLE delivery_provider_dispatch ADD COLUMN custody_review_required INTEGER NOT NULL DEFAULT 0 CHECK (custody_review_required IN (0,1));
ALTER TABLE delivery_provider_dispatch ADD COLUMN route_review_required INTEGER NOT NULL DEFAULT 0 CHECK (route_review_required IN (0,1));
ALTER TABLE delivery_provider_dispatch ADD COLUMN replacement_pending INTEGER NOT NULL DEFAULT 0 CHECK (replacement_pending IN (0,1));
ALTER TABLE delivery_provider_dispatch ADD COLUMN missing_delivery_proof INTEGER NOT NULL DEFAULT 0 CHECK (missing_delivery_proof IN (0,1));
ALTER TABLE delivery_provider_dispatch ADD COLUMN lookup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (lookup_attempts BETWEEN 0 AND 5);
ALTER TABLE delivery_provider_dispatch ADD COLUMN next_lookup_at INTEGER NOT NULL DEFAULT 0 CHECK (next_lookup_at BETWEEN 0 AND 9007199254740991);
ALTER TABLE delivery_provider_event_inbox ADD COLUMN normalized_event_json TEXT CHECK (normalized_event_json IS NULL OR (json_valid(normalized_event_json) AND length(normalized_event_json)<=65536));

CREATE TABLE delivery_provider_identity (
  provider TEXT NOT NULL CHECK (provider IN ('lalamove','grab-express')),
  provider_delivery_id TEXT NOT NULL CHECK (length(provider_delivery_id) BETWEEN 1 AND 64),
  dispatch_id TEXT NOT NULL REFERENCES delivery_provider_dispatch(id) ON DELETE RESTRICT,
  previous_provider_delivery_id TEXT,
  observed_at INTEGER NOT NULL CHECK (observed_at BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(provider,provider_delivery_id),
  UNIQUE(provider,previous_provider_delivery_id),
  FOREIGN KEY(provider,previous_provider_delivery_id) REFERENCES delivery_provider_identity(provider,provider_delivery_id),
  CHECK (previous_provider_delivery_id IS NULL OR previous_provider_delivery_id!=provider_delivery_id)
) STRICT;
INSERT INTO delivery_provider_identity(provider,provider_delivery_id,dispatch_id,observed_at)
SELECT provider,provider_delivery_id,id,created_at FROM delivery_provider_dispatch
WHERE method='EXTERNAL' AND provider_delivery_id IS NOT NULL;
CREATE TRIGGER delivery_provider_identity_immutable_update BEFORE UPDATE ON delivery_provider_identity
BEGIN SELECT RAISE(ABORT,'provider identity history is immutable'); END;
CREATE TRIGGER delivery_provider_identity_immutable_delete BEFORE DELETE ON delivery_provider_identity
BEGIN SELECT RAISE(ABORT,'provider identity history is immutable'); END;

CREATE TABLE delivery_provider_evidence (
  dispatch_id TEXT NOT NULL REFERENCES delivery_provider_dispatch(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('DRIVER','COST','DELIVERY_PROOF','PICKUP_PROOF','DELIVERY_CODE','EDIT')),
  observed_at INTEGER NOT NULL CHECK (observed_at BETWEEN 0 AND 9007199254740991),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json)<=65536),
  PRIMARY KEY(dispatch_id,kind)
) STRICT;
CREATE INDEX delivery_provider_lookup_due ON delivery_provider_dispatch(next_lookup_at,lookup_attempts) WHERE method='EXTERNAL';
