-- Canonical Delivery persistence for dispatch maps and atomic batch assignment.
-- Historical compatibility identities and JSON remain byte-preserved while
-- application-owned rider, context, stop, proof, and event rows are added.

CREATE TABLE rider_identity (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT NOT NULL UNIQUE REFERENCES staff_identity(id) ON DELETE RESTRICT,
  auth_user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
  preferred_location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO rider_identity
  (id, staff_id, auth_user_id, preferred_location_id, status, version, created_at, updated_at)
SELECT
  'rider-' || staff.id,
  staff.id,
  staff.auth_user_id,
  (
    SELECT snapshot.location_id
    FROM delivery_job job
    JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id
    WHERE job.rider_user_id = staff.auth_user_id
    ORDER BY job.created_at, job.id
    LIMIT 1
  ),
  CASE staff.status WHEN 'active' THEN 'ACTIVE' ELSE 'SUSPENDED' END,
  1,
  staff.created_at,
  staff.updated_at
FROM staff_identity staff
WHERE EXISTS (
  SELECT 1 FROM delivery_job job WHERE job.rider_user_id = staff.auth_user_id
  UNION ALL
  SELECT 1 FROM delivery_batch batch WHERE batch.rider_user_id = staff.auth_user_id
);

ALTER TABLE delivery_stop RENAME TO delivery_stop_legacy_0043;
ALTER TABLE delivery_job RENAME TO delivery_job_legacy_0043;
ALTER TABLE delivery_batch RENAME TO delivery_batch_legacy_0043;

CREATE TABLE delivery_batch (
  id TEXT PRIMARY KEY NOT NULL,
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  cycle_id TEXT REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  zone_id TEXT REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  rider_id TEXT REFERENCES rider_identity(id) ON DELETE RESTRICT,
  rider_user_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('DRAFT', 'READY', 'ASSIGNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXCEPTION')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  dispatched_at INTEGER,
  completed_at INTEGER,
  CHECK (
    (fulfillment_mode = 'INSTANT' AND cycle_id IS NULL)
    OR (fulfillment_mode = 'SCHEDULED' AND cycle_id IS NOT NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (dispatched_at IS NULL OR dispatched_at >= created_at)
);

INSERT INTO delivery_batch
  (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id, rider_user_id,
   status, version, created_at, updated_at, dispatched_at, completed_at)
SELECT
  batch.id,
  COALESCE((
    SELECT job.fulfillment_mode
    FROM delivery_stop_legacy_0043 stop
    JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id
    WHERE stop.batch_id = batch.id
    ORDER BY stop.sequence, stop.id
    LIMIT 1
  ), 'SCHEDULED'),
  batch.cycle_id,
  COALESCE(
    (
      SELECT snapshot.location_id
      FROM delivery_stop_legacy_0043 stop
      JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id
      JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id
      WHERE stop.batch_id = batch.id
      ORDER BY stop.sequence, stop.id
      LIMIT 1
    ),
    (
      SELECT capacity.location_id
      FROM cycle_zone_capacity capacity
      WHERE capacity.cycle_id = batch.cycle_id
      ORDER BY capacity.location_id, capacity.zone_id
      LIMIT 1
    )
  ),
  COALESCE(
    (
      SELECT snapshot.zone_id
      FROM delivery_stop_legacy_0043 stop
      JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id
      JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id
      WHERE stop.batch_id = batch.id
      ORDER BY stop.sequence, stop.id
      LIMIT 1
    ),
    (
      SELECT capacity.zone_id
      FROM cycle_zone_capacity capacity
      WHERE capacity.cycle_id = batch.cycle_id
      ORDER BY capacity.location_id, capacity.zone_id
      LIMIT 1
    )
  ),
  (SELECT rider.id FROM rider_identity rider WHERE rider.auth_user_id = batch.rider_user_id),
  batch.rider_user_id,
  batch.status,
  batch.version,
  batch.created_at,
  COALESCE(
    (
      SELECT MAX(job.updated_at)
      FROM delivery_stop_legacy_0043 stop
      JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id
      WHERE stop.batch_id = batch.id
    ),
    batch.created_at
  ),
  CASE
    WHEN batch.status IN ('DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'EXCEPTION') THEN batch.created_at
    ELSE NULL
  END,
  CASE
    WHEN batch.status = 'COMPLETED' THEN (
      SELECT MAX(job.delivered_at)
      FROM delivery_stop_legacy_0043 stop
      JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id
      WHERE stop.batch_id = batch.id
    )
    ELSE NULL
  END
FROM delivery_batch_legacy_0043 batch;

CREATE TABLE delivery_job (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  batch_id TEXT REFERENCES delivery_batch(id) ON DELETE RESTRICT,
  sequence INTEGER CHECK (sequence IS NULL OR sequence > 0),
  cycle_id TEXT REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  fulfillment_mode TEXT NOT NULL DEFAULT 'SCHEDULED'
    CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  zone_id TEXT REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  rider_id TEXT REFERENCES rider_identity(id) ON DELETE RESTRICT,
  rider_user_id TEXT,
  promised_at INTEGER,
  status TEXT NOT NULL CHECK (
    status IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
  ),
  address_snapshot_json TEXT NOT NULL,
  delivered_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (fulfillment_mode = 'INSTANT' AND cycle_id IS NULL)
    OR (fulfillment_mode = 'SCHEDULED' AND cycle_id IS NOT NULL)
  ),
  CHECK ((batch_id IS NULL) = (sequence IS NULL))
);

INSERT INTO delivery_job
  (id, order_id, batch_id, sequence, cycle_id, fulfillment_mode, location_id, zone_id,
   rider_id, rider_user_id, promised_at, status, address_snapshot_json, delivered_at,
   version, created_at, updated_at)
SELECT
  job.id,
  job.order_id,
  (SELECT stop.batch_id FROM delivery_stop_legacy_0043 stop WHERE stop.delivery_job_id = job.id ORDER BY stop.id LIMIT 1),
  (SELECT stop.sequence FROM delivery_stop_legacy_0043 stop WHERE stop.delivery_job_id = job.id ORDER BY stop.id LIMIT 1),
  job.cycle_id,
  job.fulfillment_mode,
  snapshot.location_id,
  snapshot.zone_id,
  (SELECT rider.id FROM rider_identity rider WHERE rider.auth_user_id = job.rider_user_id),
  job.rider_user_id,
  snapshot.promised_at,
  job.status,
  job.address_snapshot_json,
  job.delivered_at,
  job.version,
  job.created_at,
  job.updated_at
FROM delivery_job_legacy_0043 job
LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id;

CREATE TABLE delivery_stop (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id) ON DELETE RESTRICT,
  batch_id TEXT REFERENCES delivery_batch(id) ON DELETE RESTRICT,
  sequence INTEGER CHECK (sequence IS NULL OR sequence > 0),
  latitude REAL,
  longitude REAL,
  address_snapshot_json TEXT NOT NULL,
  contact_snapshot_json TEXT NOT NULL,
  instructions_snapshot TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
  ),
  proof_json TEXT,
  arrived_at INTEGER,
  delivered_at INTEGER,
  failure_reason_code TEXT,
  failure_notes TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((batch_id IS NULL) = (sequence IS NULL)),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

INSERT INTO delivery_stop
  (id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json,
   contact_snapshot_json, instructions_snapshot, status, proof_json, arrived_at,
   delivered_at, failure_reason_code, failure_notes, version, created_at, updated_at)
SELECT
  stop.id,
  stop.delivery_job_id,
  stop.batch_id,
  stop.sequence,
  json_extract(job.address_snapshot_json, '$.latitude'),
  json_extract(job.address_snapshot_json, '$.longitude'),
  job.address_snapshot_json,
  json_object(
    'recipient', json_extract(job.address_snapshot_json, '$.recipient'),
    'phone', json_extract(job.address_snapshot_json, '$.phone')
  ),
  json_extract(job.address_snapshot_json, '$.delivery_instructions_json'),
  stop.status,
  stop.proof_json,
  NULL,
  job.delivered_at,
  NULL,
  NULL,
  stop.version,
  job.created_at,
  job.updated_at
FROM delivery_stop_legacy_0043 stop
JOIN delivery_job_legacy_0043 job ON job.id = stop.delivery_job_id;

INSERT INTO delivery_stop
  (id, delivery_job_id, batch_id, sequence, latitude, longitude, address_snapshot_json,
   contact_snapshot_json, instructions_snapshot, status, proof_json, arrived_at,
   delivered_at, failure_reason_code, failure_notes, version, created_at, updated_at)
SELECT
  'stop-' || job.id,
  job.id,
  job.batch_id,
  job.sequence,
  json_extract(job.address_snapshot_json, '$.latitude'),
  json_extract(job.address_snapshot_json, '$.longitude'),
  job.address_snapshot_json,
  json_object(
    'recipient', json_extract(job.address_snapshot_json, '$.recipient'),
    'phone', json_extract(job.address_snapshot_json, '$.phone')
  ),
  json_extract(job.address_snapshot_json, '$.delivery_instructions_json'),
  job.status,
  NULL,
  NULL,
  job.delivered_at,
  NULL,
  NULL,
  job.version,
  job.created_at,
  job.updated_at
FROM delivery_job job
WHERE NOT EXISTS (
  SELECT 1 FROM delivery_stop stop WHERE stop.delivery_job_id = job.id
);

CREATE TABLE delivery_event (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id) ON DELETE RESTRICT,
  delivery_stop_id TEXT REFERENCES delivery_stop(id) ON DELETE RESTRICT,
  rider_id TEXT REFERENCES rider_identity(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (length(event_type) > 0),
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT
);

INSERT INTO delivery_event
  (id, delivery_job_id, delivery_stop_id, rider_id, event_type, occurred_at,
   recorded_at, metadata_json, idempotency_key)
SELECT
  event.id,
  event.aggregate_id,
  stop.id,
  job.rider_id,
  event.event_type,
  event.occurred_at,
  event.occurred_at,
  event.payload_json,
  NULL
FROM domain_event event
JOIN delivery_job job ON job.id = event.aggregate_id
LEFT JOIN delivery_stop stop ON stop.delivery_job_id = job.id
WHERE event.aggregate_type = 'DELIVERY_JOB';

CREATE TABLE delivery_proof (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_stop_id TEXT NOT NULL UNIQUE REFERENCES delivery_stop(id) ON DELETE RESTRICT,
  rider_id TEXT REFERENCES rider_identity(id) ON DELETE RESTRICT,
  delivered_at INTEGER,
  r2_key TEXT,
  recipient_name TEXT,
  signature_r2_key TEXT,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO delivery_proof
  (id, delivery_stop_id, rider_id, delivered_at, r2_key, recipient_name,
   signature_r2_key, metadata_json, created_at)
SELECT
  'proof-' || stop.id,
  stop.id,
  job.rider_id,
  stop.delivered_at,
  NULL,
  NULL,
  NULL,
  stop.proof_json,
  stop.updated_at
FROM delivery_stop stop
JOIN delivery_job job ON job.id = stop.delivery_job_id
WHERE stop.proof_json IS NOT NULL;

DROP TABLE delivery_stop_legacy_0043;
DROP TABLE delivery_job_legacy_0043;
DROP TABLE delivery_batch_legacy_0043;

CREATE INDEX rider_identity_status_location_idx
  ON rider_identity(status, preferred_location_id, id);
CREATE INDEX delivery_batch_active_context_idx
  ON delivery_batch(location_id, fulfillment_mode, cycle_id, zone_id, status, id)
  WHERE status NOT IN ('COMPLETED', 'CANCELED');
CREATE INDEX delivery_batch_rider_open_idx
  ON delivery_batch(rider_id, status, updated_at, id)
  WHERE rider_id IS NOT NULL AND status NOT IN ('COMPLETED', 'CANCELED');
CREATE INDEX delivery_job_context_status_idx
  ON delivery_job(location_id, fulfillment_mode, cycle_id, zone_id, status, id);
CREATE INDEX delivery_job_batch_sequence_idx
  ON delivery_job(batch_id, sequence, id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX delivery_stop_job_unique ON delivery_stop(delivery_job_id);
CREATE UNIQUE INDEX delivery_stop_batch_sequence_unique
  ON delivery_stop(batch_id, sequence) WHERE batch_id IS NOT NULL;
CREATE INDEX delivery_event_job_time_idx
  ON delivery_event(delivery_job_id, occurred_at, id);
CREATE UNIQUE INDEX delivery_event_idempotency_unique
  ON delivery_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX delivery_proof_rider_time_idx
  ON delivery_proof(rider_id, delivered_at, id);

CREATE TRIGGER delivery_batch_canonical_status_insert
BEFORE INSERT ON delivery_batch
WHEN NEW.status NOT IN ('DRAFT', 'READY', 'ASSIGNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXCEPTION')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_BATCH_STATUS'); END;

CREATE TRIGGER delivery_batch_canonical_status_update
BEFORE UPDATE OF status ON delivery_batch
WHEN NEW.status NOT IN ('DRAFT', 'READY', 'ASSIGNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXCEPTION')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_BATCH_STATUS'); END;

CREATE TRIGGER delivery_job_canonical_status_insert
BEFORE INSERT ON delivery_job
WHEN NEW.status NOT IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END;

CREATE TRIGGER delivery_job_canonical_status_update
BEFORE UPDATE OF status ON delivery_job
WHEN NEW.status NOT IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STATUS'); END;

CREATE TRIGGER delivery_stop_canonical_status_insert
BEFORE INSERT ON delivery_stop
WHEN NEW.status NOT IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STOP_STATUS'); END;

CREATE TRIGGER delivery_stop_canonical_status_update
BEFORE UPDATE OF status ON delivery_stop
WHEN NEW.status NOT IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
BEGIN SELECT RAISE(ABORT, 'INVALID_DELIVERY_STOP_STATUS'); END;

CREATE TRIGGER delivery_stop_immutable_destination_update
BEFORE UPDATE OF latitude, longitude, address_snapshot_json, contact_snapshot_json, instructions_snapshot
ON delivery_stop
WHEN NEW.latitude IS NOT OLD.latitude
  OR NEW.longitude IS NOT OLD.longitude
  OR NEW.address_snapshot_json IS NOT OLD.address_snapshot_json
  OR NEW.contact_snapshot_json IS NOT OLD.contact_snapshot_json
  OR NEW.instructions_snapshot IS NOT OLD.instructions_snapshot
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_DELIVERY_STOP_DESTINATION'); END;

CREATE TRIGGER delivery_event_append_only_update
BEFORE UPDATE ON delivery_event
BEGIN SELECT RAISE(ABORT, 'DELIVERY_EVENT_APPEND_ONLY'); END;

CREATE TRIGGER delivery_event_append_only_delete
BEFORE DELETE ON delivery_event
BEGIN SELECT RAISE(ABORT, 'DELIVERY_EVENT_APPEND_ONLY'); END;
