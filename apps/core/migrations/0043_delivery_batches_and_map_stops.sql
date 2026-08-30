-- Canonical Delivery persistence for dispatch maps and atomic batch assignment.
-- Every pre-0043 batch/stop row is retained byte-for-byte in compatibility
-- history before malformed-but-schema-valid legacy shapes are reconciled.

CREATE TABLE rider_identity (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT UNIQUE REFERENCES staff_identity(id) ON DELETE RESTRICT,
  auth_user_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  preferred_location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Only valid application Staff links become canonical Rider links. Historical
-- auth-user strings that cannot be resolved remain in compatibility columns.
INSERT INTO rider_identity
  (id, staff_id, auth_user_id, display_name, preferred_location_id, status,
   version, created_at, updated_at)
SELECT
  'rider-' || staff.id,
  staff.id,
  staff.auth_user_id,
  staff.display_name,
  (
    SELECT snapshot.location_id
    FROM delivery_job job
    JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id
    WHERE job.rider_user_id = staff.auth_user_id
      AND EXISTS (SELECT 1 FROM fulfillment_location location WHERE location.id = snapshot.location_id)
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

CREATE TABLE delivery_batch_compatibility_history (
  delivery_batch_id TEXT PRIMARY KEY NOT NULL,
  original_cycle_id TEXT,
  original_status TEXT NOT NULL,
  original_rider_user_id TEXT,
  original_created_at INTEGER NOT NULL,
  original_version INTEGER NOT NULL,
  preserved_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO delivery_batch_compatibility_history
  (delivery_batch_id, original_cycle_id, original_status,
   original_rider_user_id, original_created_at, original_version, preserved_at)
SELECT id, cycle_id, status, rider_user_id, created_at, version, 0
FROM delivery_batch_legacy_0043;

CREATE TABLE delivery_stop_compatibility_history (
  delivery_stop_id TEXT PRIMARY KEY NOT NULL,
  original_batch_id TEXT,
  delivery_job_id TEXT NOT NULL,
  original_sequence INTEGER,
  original_status TEXT NOT NULL,
  proof_json TEXT,
  original_version INTEGER NOT NULL,
  preserved_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO delivery_stop_compatibility_history
  (delivery_stop_id, original_batch_id, delivery_job_id, original_sequence,
   original_status, proof_json, original_version, preserved_at)
SELECT id, batch_id, delivery_job_id, sequence, status, proof_json, version, 0
FROM delivery_stop_legacy_0043;

CREATE TABLE delivery_job_compatibility_history (
  delivery_job_id TEXT PRIMARY KEY NOT NULL,
  original_order_id TEXT NOT NULL,
  original_cycle_id TEXT,
  original_fulfillment_mode TEXT NOT NULL,
  original_rider_user_id TEXT,
  original_status TEXT NOT NULL,
  original_address_snapshot_json TEXT NOT NULL,
  original_delivered_at INTEGER,
  original_version INTEGER NOT NULL,
  original_created_at INTEGER NOT NULL,
  original_updated_at INTEGER NOT NULL,
  preserved_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO delivery_job_compatibility_history
  (delivery_job_id, original_order_id, original_cycle_id,
   original_fulfillment_mode, original_rider_user_id, original_status,
   original_address_snapshot_json, original_delivered_at, original_version,
   original_created_at, original_updated_at, preserved_at)
SELECT id, order_id, cycle_id, fulfillment_mode, rider_user_id, status,
       address_snapshot_json, delivered_at, version, created_at, updated_at, 0
FROM delivery_job_legacy_0043;

-- Reconcile one stop per job first. Batch context is then aggregated from the
-- complete chosen-job set, never from whichever stop id happens to sort first.
CREATE TABLE delivery_job_stage_0043 AS
WITH ranked_stops AS (
  SELECT
    stop.*,
    ROW_NUMBER() OVER (
      PARTITION BY stop.delivery_job_id
      ORDER BY
        CASE WHEN stop.batch_id IS NULL THEN 1 ELSE 0 END,
        CASE WHEN stop.sequence > 0 THEN 0 ELSE 1 END,
        CASE WHEN stop.sequence > 0 THEN stop.sequence ELSE 2147483647 END,
        stop.id
    ) AS job_rank
  FROM delivery_stop_legacy_0043 stop
),
chosen_stops AS (
  SELECT * FROM ranked_stops WHERE job_rank = 1
),
sequenced_stops AS (
  SELECT
    chosen.*,
    CASE
      WHEN chosen.batch_id IS NULL THEN NULL
      ELSE ROW_NUMBER() OVER (
        PARTITION BY chosen.batch_id
        ORDER BY
          CASE WHEN chosen.sequence > 0 THEN 0 ELSE 1 END,
          CASE WHEN chosen.sequence > 0 THEN chosen.sequence ELSE 2147483647 END,
          chosen.delivery_job_id,
          chosen.id
      )
    END AS canonical_sequence
  FROM chosen_stops chosen
),
job_evidence AS (
  SELECT
    job.*,
    selected.id AS selected_stop_id,
    selected.batch_id AS selected_batch_id,
    selected.canonical_sequence,
    selected.status AS selected_stop_status,
    selected.proof_json AS selected_stop_proof_json,
    selected.version AS selected_stop_version,
    snapshot.location_id AS snapshot_location_id,
    snapshot.zone_id AS snapshot_zone_id,
    snapshot.cycle_id AS snapshot_cycle_id,
    snapshot.fulfillment_mode AS snapshot_fulfillment_mode,
    snapshot.promised_at AS snapshot_promised_at,
    CASE
      WHEN job.fulfillment_mode = 'INSTANT'
        AND job.cycle_id IS NULL
        AND snapshot.fulfillment_mode = 'INSTANT'
        AND snapshot.cycle_id IS NULL
        AND EXISTS (SELECT 1 FROM fulfillment_location location WHERE location.id = snapshot.location_id)
        AND EXISTS (SELECT 1 FROM delivery_zone zone WHERE zone.id = snapshot.zone_id)
        THEN 1
      WHEN job.fulfillment_mode = 'SCHEDULED'
        AND job.cycle_id IS NOT NULL
        AND snapshot.fulfillment_mode = 'SCHEDULED'
        AND snapshot.cycle_id = job.cycle_id
        AND EXISTS (SELECT 1 FROM delivery_cycle cycle WHERE cycle.id = job.cycle_id)
        AND EXISTS (SELECT 1 FROM fulfillment_location location WHERE location.id = snapshot.location_id)
        AND EXISTS (SELECT 1 FROM delivery_zone zone WHERE zone.id = snapshot.zone_id)
        THEN 1
      ELSE 0
    END AS context_is_resolved
  FROM delivery_job_legacy_0043 job
  LEFT JOIN order_fulfillment_snapshot snapshot ON snapshot.order_id = job.order_id
  LEFT JOIN sequenced_stops selected ON selected.delivery_job_id = job.id
)
SELECT * FROM job_evidence;

-- Pick one deterministic namespace longer than every legacy stop id. Generated
-- ids within it cannot collide with any preserved legacy id, and unique job ids
-- make the generated ids mutually distinct.
CREATE TABLE delivery_stop_id_stage_0043 AS
WITH generated_namespace AS (
  SELECT lower(hex(zeroblob(CAST(COALESCE(MAX(length(id)), 0) / 2 AS INTEGER) + 1))) || '-' AS prefix
  FROM delivery_stop_legacy_0043
)
SELECT
  stage.id AS delivery_job_id,
  COALESCE(stage.selected_stop_id, namespace.prefix || stage.id) AS canonical_stop_id
FROM delivery_job_stage_0043 stage
CROSS JOIN generated_namespace namespace;

CREATE TABLE delivery_batch (
  id TEXT PRIMARY KEY NOT NULL,
  fulfillment_mode TEXT DEFAULT 'SCHEDULED'
    CHECK (fulfillment_mode IS NULL OR fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  cycle_id TEXT REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  zone_id TEXT REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  rider_id TEXT REFERENCES rider_identity(id) ON DELETE RESTRICT,
  rider_user_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('DRAFT', 'READY', 'ASSIGNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXCEPTION')
  ),
  context_resolution_status TEXT NOT NULL DEFAULT 'RESOLVED'
    CHECK (context_resolution_status IN ('RESOLVED', 'LEGACY_UNRESOLVED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  dispatched_at INTEGER,
  completed_at INTEGER,
  CHECK (
    (
      context_resolution_status = 'RESOLVED'
      AND location_id IS NOT NULL
      AND zone_id IS NOT NULL
      AND (
        (fulfillment_mode = 'INSTANT' AND cycle_id IS NULL)
        OR (fulfillment_mode = 'SCHEDULED' AND cycle_id IS NOT NULL)
      )
    )
    OR (
      context_resolution_status = 'LEGACY_UNRESOLVED'
      AND fulfillment_mode IS NULL
      AND cycle_id IS NULL
      AND location_id IS NULL
      AND zone_id IS NULL
      AND status = 'EXCEPTION'
    )
  ),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (dispatched_at IS NULL OR dispatched_at >= created_at)
);

WITH batch_evidence AS (
  SELECT
    batch.id,
    COUNT(stage.id) AS chosen_job_count,
    COALESCE(SUM(stage.context_is_resolved), 0) AS resolved_job_count,
    MIN(stage.fulfillment_mode) AS minimum_mode,
    MAX(stage.fulfillment_mode) AS maximum_mode,
    MIN(CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_location_id END) AS minimum_location_id,
    MAX(CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_location_id END) AS maximum_location_id,
    MIN(CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_zone_id END) AS minimum_zone_id,
    MAX(CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_zone_id END) AS maximum_zone_id,
    MIN(CASE WHEN stage.context_is_resolved = 1 THEN stage.cycle_id END) AS minimum_cycle_id,
    MAX(CASE WHEN stage.context_is_resolved = 1 THEN stage.cycle_id END) AS maximum_cycle_id,
    MAX(stage.updated_at) AS last_job_update,
    MAX(stage.delivered_at) AS last_delivery
  FROM delivery_batch_legacy_0043 batch
  LEFT JOIN delivery_job_stage_0043 stage ON stage.selected_batch_id = batch.id
  GROUP BY batch.id
),
resolved_batch AS (
  SELECT
    batch.*,
    evidence.*,
    CASE
      WHEN evidence.chosen_job_count = 0 THEN 0
      WHEN evidence.resolved_job_count <> evidence.chosen_job_count THEN 0
      WHEN evidence.minimum_mode <> evidence.maximum_mode THEN 0
      WHEN evidence.minimum_location_id IS NULL
        OR evidence.minimum_location_id <> evidence.maximum_location_id THEN 0
      WHEN evidence.minimum_zone_id IS NULL
        OR evidence.minimum_zone_id <> evidence.maximum_zone_id THEN 0
      WHEN evidence.minimum_mode = 'INSTANT' THEN 1
      WHEN evidence.minimum_mode = 'SCHEDULED'
        AND evidence.minimum_cycle_id IS NOT NULL
        AND evidence.minimum_cycle_id = evidence.maximum_cycle_id
        AND batch.cycle_id = evidence.minimum_cycle_id THEN 1
      ELSE 0
    END AS context_is_resolved
  FROM delivery_batch_legacy_0043 batch
  JOIN batch_evidence evidence ON evidence.id = batch.id
)
INSERT INTO delivery_batch
  (id, fulfillment_mode, cycle_id, location_id, zone_id, rider_id,
   rider_user_id, status, context_resolution_status, version, created_at,
   updated_at, dispatched_at, completed_at)
SELECT
  batch.id,
  CASE WHEN batch.context_is_resolved = 1 THEN batch.minimum_mode ELSE NULL END,
  CASE
    WHEN batch.context_is_resolved = 1 AND batch.minimum_mode = 'SCHEDULED'
      THEN batch.minimum_cycle_id
    ELSE NULL
  END,
  CASE WHEN batch.context_is_resolved = 1 THEN batch.minimum_location_id ELSE NULL END,
  CASE WHEN batch.context_is_resolved = 1 THEN batch.minimum_zone_id ELSE NULL END,
  (SELECT rider.id FROM rider_identity rider WHERE rider.auth_user_id = batch.rider_user_id),
  batch.rider_user_id,
  CASE
    WHEN batch.context_is_resolved = 0 THEN 'EXCEPTION'
    WHEN batch.status = 'COMPLETED'
      AND (batch.last_delivery IS NULL OR batch.last_delivery < batch.created_at)
      THEN 'EXCEPTION'
    WHEN batch.status IN ('DRAFT', 'READY', 'ASSIGNED', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'EXCEPTION') THEN batch.status
    ELSE 'EXCEPTION'
  END,
  CASE WHEN batch.context_is_resolved = 1 THEN 'RESOLVED' ELSE 'LEGACY_UNRESOLVED' END,
  CASE WHEN batch.version > 0 THEN batch.version ELSE 1 END,
  batch.created_at,
  CASE
    WHEN batch.last_job_update IS NULL OR batch.last_job_update < batch.created_at
      THEN batch.created_at
    ELSE batch.last_job_update
  END,
  CASE
    WHEN batch.context_is_resolved = 1
      AND batch.status IN ('DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'EXCEPTION')
      AND NOT (
        batch.status = 'COMPLETED'
        AND (batch.last_delivery IS NULL OR batch.last_delivery < batch.created_at)
      )
      THEN batch.created_at
    ELSE NULL
  END,
  CASE
    WHEN batch.context_is_resolved = 1
      AND batch.status = 'COMPLETED'
      AND batch.last_delivery >= batch.created_at
      THEN batch.last_delivery
    ELSE NULL
  END
FROM resolved_batch batch;

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
  context_resolution_status TEXT NOT NULL DEFAULT 'RESOLVED'
    CHECK (context_resolution_status IN ('RESOLVED', 'LEGACY_UNRESOLVED')),
  address_snapshot_json TEXT NOT NULL,
  delivered_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (
      context_resolution_status = 'RESOLVED'
      AND location_id IS NOT NULL
      AND zone_id IS NOT NULL
      AND (
        (fulfillment_mode = 'INSTANT' AND cycle_id IS NULL)
        OR (fulfillment_mode = 'SCHEDULED' AND cycle_id IS NOT NULL)
      )
    )
    OR (
      context_resolution_status = 'LEGACY_UNRESOLVED'
      AND fulfillment_mode = 'SCHEDULED'
      AND cycle_id IS NULL
      AND location_id IS NULL
      AND zone_id IS NULL
      AND status = 'ESCALATED'
    )
  ),
  CHECK ((batch_id IS NULL) = (sequence IS NULL))
);

INSERT INTO delivery_job
  (id, order_id, batch_id, sequence, cycle_id, fulfillment_mode, location_id,
   zone_id, rider_id, rider_user_id, promised_at, status,
   context_resolution_status, address_snapshot_json, delivered_at, version,
   created_at, updated_at)
SELECT
  stage.id,
  stage.order_id,
  stage.selected_batch_id,
  stage.canonical_sequence,
  CASE WHEN stage.context_is_resolved = 1 THEN stage.cycle_id ELSE NULL END,
  CASE WHEN stage.context_is_resolved = 1 THEN stage.fulfillment_mode ELSE 'SCHEDULED' END,
  CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_location_id ELSE NULL END,
  CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_zone_id ELSE NULL END,
  (SELECT rider.id FROM rider_identity rider WHERE rider.auth_user_id = stage.rider_user_id),
  stage.rider_user_id,
  CASE WHEN stage.context_is_resolved = 1 THEN stage.snapshot_promised_at ELSE NULL END,
  CASE
    WHEN stage.context_is_resolved = 0 THEN 'ESCALATED'
    WHEN stage.status IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED') THEN stage.status
    ELSE 'ESCALATED'
  END,
  CASE WHEN stage.context_is_resolved = 1 THEN 'RESOLVED' ELSE 'LEGACY_UNRESOLVED' END,
  stage.address_snapshot_json,
  stage.delivered_at,
  CASE WHEN stage.version > 0 THEN stage.version ELSE 1 END,
  stage.created_at,
  stage.updated_at
FROM delivery_job_stage_0043 stage;

CREATE TABLE delivery_stop (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_job_id TEXT NOT NULL REFERENCES delivery_job(id) ON DELETE RESTRICT,
  batch_id TEXT REFERENCES delivery_batch(id) ON DELETE RESTRICT,
  sequence INTEGER CHECK (sequence IS NULL OR sequence > 0),
  latitude REAL,
  longitude REAL,
  address_snapshot_json TEXT NOT NULL DEFAULT '{}',
  contact_snapshot_json TEXT NOT NULL DEFAULT '{"recipient":null,"phone":null}',
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
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  CHECK ((batch_id IS NULL) = (sequence IS NULL)),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

INSERT INTO delivery_stop
  (id, delivery_job_id, batch_id, sequence, latitude, longitude,
   address_snapshot_json, contact_snapshot_json, instructions_snapshot,
   status, proof_json, arrived_at, delivered_at, failure_reason_code,
   failure_notes, version, created_at, updated_at)
SELECT
  allocated.canonical_stop_id,
  job.id,
  job.batch_id,
  job.sequence,
  CASE
    WHEN json_valid(job.address_snapshot_json)
      AND json_type(job.address_snapshot_json, '$.latitude') IN ('integer', 'real')
      AND json_type(job.address_snapshot_json, '$.longitude') IN ('integer', 'real')
      AND json_extract(job.address_snapshot_json, '$.latitude') BETWEEN -90 AND 90
      AND json_extract(job.address_snapshot_json, '$.longitude') BETWEEN -180 AND 180
      THEN json_extract(job.address_snapshot_json, '$.latitude')
    ELSE NULL
  END,
  CASE
    WHEN json_valid(job.address_snapshot_json)
      AND json_type(job.address_snapshot_json, '$.latitude') IN ('integer', 'real')
      AND json_type(job.address_snapshot_json, '$.longitude') IN ('integer', 'real')
      AND json_extract(job.address_snapshot_json, '$.latitude') BETWEEN -90 AND 90
      AND json_extract(job.address_snapshot_json, '$.longitude') BETWEEN -180 AND 180
      THEN json_extract(job.address_snapshot_json, '$.longitude')
    ELSE NULL
  END,
  job.address_snapshot_json,
  CASE
    WHEN json_valid(job.address_snapshot_json) THEN json_object(
      'recipient', json_extract(job.address_snapshot_json, '$.recipient'),
      'phone', json_extract(job.address_snapshot_json, '$.phone')
    )
    ELSE '{"recipient":null,"phone":null}'
  END,
  CASE
    WHEN NOT json_valid(job.address_snapshot_json) THEN NULL
    WHEN json_type(job.address_snapshot_json, '$.delivery_instructions_json') IS NOT NULL
      AND json_type(job.address_snapshot_json, '$.delivery_instructions_json') <> 'null'
      THEN json_extract(job.address_snapshot_json, '$.delivery_instructions_json')
    WHEN json_extract(job.address_snapshot_json, '$.notes') IS NOT NULL
      THEN json_object(
        'deliveryNote', json_extract(job.address_snapshot_json, '$.notes')
      )
    ELSE NULL
  END,
  CASE
    WHEN COALESCE((
      SELECT stop.status
      FROM delivery_stop_legacy_0043 stop
      WHERE stop.delivery_job_id = job.id
      ORDER BY
        CASE WHEN stop.batch_id IS NULL THEN 1 ELSE 0 END,
        CASE WHEN stop.sequence > 0 THEN 0 ELSE 1 END,
        CASE WHEN stop.sequence > 0 THEN stop.sequence ELSE 2147483647 END,
        stop.id
      LIMIT 1
    ), job.status) IN ('UNASSIGNED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'ESCALATED', 'CANCELED')
      THEN COALESCE((
        SELECT stop.status
        FROM delivery_stop_legacy_0043 stop
        WHERE stop.delivery_job_id = job.id
        ORDER BY
          CASE WHEN stop.batch_id IS NULL THEN 1 ELSE 0 END,
          CASE WHEN stop.sequence > 0 THEN 0 ELSE 1 END,
          CASE WHEN stop.sequence > 0 THEN stop.sequence ELSE 2147483647 END,
          stop.id
        LIMIT 1
      ), job.status)
    ELSE job.status
  END,
  (
    SELECT stop.proof_json
    FROM delivery_stop_legacy_0043 stop
    WHERE stop.delivery_job_id = job.id
    ORDER BY
      CASE WHEN stop.batch_id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN stop.sequence > 0 THEN 0 ELSE 1 END,
      CASE WHEN stop.sequence > 0 THEN stop.sequence ELSE 2147483647 END,
      stop.id
    LIMIT 1
  ),
  NULL,
  job.delivered_at,
  NULL,
  NULL,
  COALESCE((
    SELECT CASE WHEN stop.version > 0 THEN stop.version ELSE 1 END
    FROM delivery_stop_legacy_0043 stop
    WHERE stop.delivery_job_id = job.id
    ORDER BY
      CASE WHEN stop.batch_id IS NULL THEN 1 ELSE 0 END,
      CASE WHEN stop.sequence > 0 THEN 0 ELSE 1 END,
      CASE WHEN stop.sequence > 0 THEN stop.sequence ELSE 2147483647 END,
      stop.id
    LIMIT 1
  ), job.version),
  job.created_at,
  job.updated_at
FROM delivery_job job
JOIN delivery_stop_id_stage_0043 allocated ON allocated.delivery_job_id = job.id;

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
  CASE WHEN length(trim(event.event_type, ' ' || char(9) || char(10) || char(11) || char(12) || char(13))) > 0
    THEN event.event_type ELSE 'LEGACY_COMPATIBILITY' END,
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

DROP TABLE delivery_job_stage_0043;
DROP TABLE delivery_stop_id_stage_0043;
DROP TABLE delivery_stop_legacy_0043;
DROP TABLE delivery_job_legacy_0043;
DROP TABLE delivery_batch_legacy_0043;

CREATE INDEX rider_identity_status_location_idx
  ON rider_identity(status, preferred_location_id, id);
CREATE INDEX delivery_batch_context_resolution_idx
  ON delivery_batch(context_resolution_status, status, id);
CREATE INDEX delivery_batch_active_context_idx
  ON delivery_batch(location_id, fulfillment_mode, cycle_id, zone_id, status, id)
  WHERE context_resolution_status = 'RESOLVED'
    AND status NOT IN ('COMPLETED', 'CANCELED');
CREATE INDEX delivery_batch_rider_open_idx
  ON delivery_batch(rider_id, status, updated_at, id)
  WHERE rider_id IS NOT NULL
    AND context_resolution_status = 'RESOLVED'
    AND status NOT IN ('COMPLETED', 'CANCELED');
CREATE INDEX delivery_job_context_status_idx
  ON delivery_job(context_resolution_status, location_id, fulfillment_mode, cycle_id, zone_id, status, id);
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
CREATE INDEX delivery_batch_compatibility_history_cycle_idx
  ON delivery_batch_compatibility_history(original_cycle_id, delivery_batch_id);
CREATE INDEX delivery_job_compatibility_history_order_idx
  ON delivery_job_compatibility_history(original_order_id, delivery_job_id);
CREATE INDEX delivery_stop_compatibility_history_job_idx
  ON delivery_stop_compatibility_history(delivery_job_id, delivery_stop_id);
CREATE INDEX delivery_stop_compatibility_history_batch_sequence_idx
  ON delivery_stop_compatibility_history(original_batch_id, original_sequence, delivery_stop_id);

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

CREATE TRIGGER delivery_batch_compatibility_history_append_only_update
BEFORE UPDATE ON delivery_batch_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER delivery_batch_compatibility_history_append_only_delete
BEFORE DELETE ON delivery_batch_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER delivery_job_compatibility_history_append_only_update
BEFORE UPDATE ON delivery_job_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER delivery_job_compatibility_history_append_only_delete
BEFORE DELETE ON delivery_job_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER delivery_stop_compatibility_history_append_only_update
BEFORE UPDATE ON delivery_stop_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;

CREATE TRIGGER delivery_stop_compatibility_history_append_only_delete
BEFORE DELETE ON delivery_stop_compatibility_history
BEGIN SELECT RAISE(ABORT, 'DELIVERY_COMPATIBILITY_HISTORY_APPEND_ONLY'); END;
