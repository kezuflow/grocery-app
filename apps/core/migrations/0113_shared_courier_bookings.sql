-- One provider booking owns the courier payable; individual attempts own Order outcomes.
CREATE TABLE delivery_shared_booking (
  id TEXT PRIMARY KEY NOT NULL,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider='lalamove'),
  merchant_order_id TEXT NOT NULL UNIQUE,
  prepare_key TEXT NOT NULL UNIQUE,
  prepare_hash TEXT NOT NULL,
  prepare_result_json TEXT CHECK (prepare_result_json IS NULL OR json_valid(prepare_result_json)),
  confirm_key TEXT UNIQUE,
  confirm_hash TEXT,
  confirm_result_json TEXT CHECK (confirm_result_json IS NULL OR json_valid(confirm_result_json)),
  request_snapshot_json TEXT NOT NULL CHECK (json_valid(request_snapshot_json)),
  quotation_snapshot_json TEXT NOT NULL CHECK (json_valid(quotation_snapshot_json)),
  status TEXT NOT NULL CHECK (status IN ('PREPARED','CREATING','ACTIVE','COMPLETED','CANCELED','FAILED','OUTCOME_UNKNOWN','RECONCILIATION_REQUIRED')),
  provider_delivery_id TEXT UNIQUE,
  provider_status TEXT,
  provider_observed_at INTEGER,
  driver_id TEXT,
  driver_observed_at INTEGER,
  tracking_url TEXT,
  quote_amount_minor INTEGER NOT NULL CHECK (quote_amount_minor>=0),
  final_payable_minor INTEGER CHECK (final_payable_minor IS NULL OR final_payable_minor>=0),
  cost_observed_at INTEGER CHECK (cost_observed_at IS NULL OR cost_observed_at>=0),
  currency TEXT NOT NULL CHECK (currency='PHP'),
  expires_at INTEGER NOT NULL CHECK (expires_at>=0),
  combined_load_confirmed_at INTEGER,
  cancel_pending INTEGER NOT NULL DEFAULT 0 CHECK (cancel_pending IN (0,1)),
  route_review_required INTEGER NOT NULL DEFAULT 0 CHECK (route_review_required IN (0,1)),
  custody_review_required INTEGER NOT NULL DEFAULT 0 CHECK (custody_review_required IN (0,1)),
  replacement_pending INTEGER NOT NULL DEFAULT 0 CHECK (replacement_pending IN (0,1)),
  last_error_code TEXT,
  lookup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (lookup_attempts BETWEEN 0 AND 5),
  next_lookup_at INTEGER NOT NULL DEFAULT 0 CHECK (next_lookup_at>=0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

ALTER TABLE delivery_provider_dispatch ADD COLUMN shared_booking_id TEXT REFERENCES delivery_shared_booking(id) ON DELETE RESTRICT;
ALTER TABLE delivery_provider_event_inbox ADD COLUMN shared_booking_id TEXT REFERENCES delivery_shared_booking(id) ON DELETE RESTRICT;

CREATE TABLE delivery_shared_booking_member (
  booking_id TEXT NOT NULL REFERENCES delivery_shared_booking(id) ON DELETE RESTRICT,
  job_id TEXT NOT NULL REFERENCES delivery_job(id) ON DELETE RESTRICT,
  dispatch_id TEXT UNIQUE REFERENCES delivery_provider_dispatch(id) ON DELETE RESTRICT,
  provider_stop_id TEXT NOT NULL,
  provider_position INTEGER NOT NULL CHECK (provider_position BETWEEN 1 AND 5),
  source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
  outcome TEXT NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING','DELIVERED','FAILED')),
  observed_at INTEGER,
  PRIMARY KEY(booking_id,job_id),
  UNIQUE(booking_id,provider_stop_id),
  UNIQUE(booking_id,provider_position)
) STRICT;
CREATE INDEX delivery_shared_booking_lookup_due ON delivery_shared_booking(status,next_lookup_at,lookup_attempts);
CREATE INDEX delivery_shared_booking_member_job ON delivery_shared_booking_member(job_id,booking_id);
CREATE INDEX delivery_provider_dispatch_shared ON delivery_provider_dispatch(shared_booking_id);

CREATE TABLE delivery_shared_booking_command (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES delivery_shared_booking(id) ON DELETE RESTRICT,
  dispatch_id TEXT NOT NULL REFERENCES delivery_provider_dispatch(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('REFRESH','CANCEL')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTING','OUTCOME_UNKNOWN','SUCCEEDED','REJECTED')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(operation,idempotency_key)
) STRICT;
CREATE UNIQUE INDEX delivery_shared_booking_cancel_pending ON delivery_shared_booking_command(booking_id)
WHERE operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN');

CREATE TABLE delivery_shared_booking_identity (
  provider_delivery_id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES delivery_shared_booking(id) ON DELETE RESTRICT,
  observed_at INTEGER NOT NULL CHECK (observed_at>=0)
) STRICT;
CREATE TRIGGER delivery_shared_booking_identity_immutable_update BEFORE UPDATE ON delivery_shared_booking_identity
BEGIN SELECT RAISE(ABORT,'shared provider identity history is immutable'); END;
CREATE TRIGGER delivery_shared_booking_identity_immutable_delete BEFORE DELETE ON delivery_shared_booking_identity
BEGIN SELECT RAISE(ABORT,'shared provider identity history is immutable'); END;
CREATE TRIGGER delivery_shared_booking_identity_collision BEFORE INSERT ON delivery_shared_booking_identity
WHEN EXISTS (SELECT 1 FROM delivery_provider_identity WHERE provider='lalamove' AND provider_delivery_id=NEW.provider_delivery_id)
BEGIN SELECT RAISE(ABORT,'provider identity belongs to another booking'); END;
CREATE TRIGGER delivery_provider_identity_shared_collision BEFORE INSERT ON delivery_provider_identity
WHEN NEW.provider='lalamove' AND EXISTS (SELECT 1 FROM delivery_shared_booking_identity WHERE provider_delivery_id=NEW.provider_delivery_id)
BEGIN SELECT RAISE(ABORT,'provider identity belongs to a shared booking'); END;

CREATE TRIGGER delivery_shared_member_mapping_immutable BEFORE UPDATE ON delivery_shared_booking_member
WHEN NEW.booking_id!=OLD.booking_id OR NEW.job_id!=OLD.job_id OR NEW.provider_stop_id!=OLD.provider_stop_id
  OR NEW.provider_position!=OLD.provider_position OR NEW.source_snapshot_json!=OLD.source_snapshot_json
  OR (OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS NOT OLD.dispatch_id)
BEGIN SELECT RAISE(ABORT,'shared booking membership is immutable'); END;

CREATE TRIGGER delivery_shared_member_dispatch_guard BEFORE UPDATE OF dispatch_id ON delivery_shared_booking_member
WHEN NEW.dispatch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch d
  WHERE d.id=NEW.dispatch_id AND d.delivery_job_id=NEW.job_id AND d.shared_booking_id=NEW.booking_id)
BEGIN SELECT RAISE(ABORT,'shared booking attempt identity mismatch'); END;

CREATE TRIGGER delivery_shared_receipt_immutable BEFORE UPDATE ON delivery_shared_booking
WHEN NEW.prepare_key!=OLD.prepare_key OR NEW.prepare_hash!=OLD.prepare_hash
  OR NEW.prepare_result_json IS NOT OLD.prepare_result_json
  OR NEW.request_snapshot_json!=OLD.request_snapshot_json OR NEW.quotation_snapshot_json!=OLD.quotation_snapshot_json
  OR NEW.location_id!=OLD.location_id OR NEW.merchant_order_id!=OLD.merchant_order_id
  OR (OLD.confirm_key IS NOT NULL AND (NEW.confirm_key IS NOT OLD.confirm_key OR NEW.confirm_hash IS NOT OLD.confirm_hash))
  OR (OLD.confirm_result_json IS NOT NULL AND NEW.confirm_result_json IS NOT OLD.confirm_result_json)
BEGIN SELECT RAISE(ABORT,'shared booking intent and success receipts are immutable'); END;

CREATE TRIGGER delivery_shared_command_receipt_immutable BEFORE UPDATE ON delivery_shared_booking_command
WHEN NEW.request_hash!=OLD.request_hash OR NEW.idempotency_key!=OLD.idempotency_key OR NEW.booking_id!=OLD.booking_id
  OR NEW.dispatch_id!=OLD.dispatch_id OR NEW.operation!=OLD.operation OR NEW.actor_user_id!=OLD.actor_user_id
  OR NEW.location_id!=OLD.location_id OR (OLD.result_json IS NOT NULL AND NEW.result_json IS NOT OLD.result_json)
BEGIN SELECT RAISE(ABORT,'shared provider command intent and receipts are immutable'); END;

CREATE TRIGGER delivery_shared_dispatch_identity_guard_insert BEFORE INSERT ON delivery_provider_dispatch
WHEN NEW.shared_booking_id IS NOT NULL AND (NEW.method!='EXTERNAL' OR NEW.provider!='lalamove'
  OR NEW.provider_delivery_id IS NOT NULL OR NEW.final_payable_minor IS NOT NULL OR NEW.quote_amount_minor IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'shared provider identity and costs belong to the shared booking'); END;
CREATE TRIGGER delivery_shared_dispatch_identity_guard_update BEFORE UPDATE ON delivery_provider_dispatch
WHEN NEW.shared_booking_id IS NOT OLD.shared_booking_id OR (NEW.shared_booking_id IS NOT NULL AND
  (NEW.provider_delivery_id IS NOT NULL OR NEW.final_payable_minor IS NOT NULL OR NEW.quote_amount_minor IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'shared provider identity and costs belong to the shared booking'); END;
