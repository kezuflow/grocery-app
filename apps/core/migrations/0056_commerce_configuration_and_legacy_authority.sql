-- Establish the forward commerce authority without deleting compatibility data.
-- Existing installations remain selling-open when Phase 3 moves callers to the
-- new singleton; mode/cadence/version/timestamps copy exactly from 0052.

CREATE TABLE global_commerce_configuration (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'global'),
  selling_state TEXT NOT NULL CHECK (selling_state IN ('OPEN', 'PAUSED')),
  fulfillment_mode TEXT NOT NULL CHECK (fulfillment_mode IN ('INSTANT', 'SCHEDULED')),
  cadence TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (fulfillment_mode = 'SCHEDULED' AND cadence = 'WEEKLY') OR
    (fulfillment_mode = 'INSTANT' AND cadence IS NULL)
  )
);

INSERT INTO global_commerce_configuration (
  id, selling_state, fulfillment_mode, cadence, version, created_at, updated_at
)
SELECT id, 'OPEN', active_mode, cadence, version, created_at, updated_at
FROM global_fulfillment_mode;

-- Scheduled cycle/zone/location rows now have a capacity-free target model.
-- The capacity tables remain untouched for historical reads and until all
-- compatibility callers have moved in later phases.
CREATE TABLE delivery_cycle_zone (
  cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES delivery_zone(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, zone_id, location_id)
);

INSERT INTO delivery_cycle_zone (
  cycle_id, zone_id, location_id, status, version, created_at, updated_at
)
SELECT
  capacity.cycle_id,
  capacity.zone_id,
  capacity.location_id,
  'ACTIVE',
  capacity.version,
  COALESCE(cycle.order_opens_at, 0),
  COALESCE(cycle.order_opens_at, 0)
FROM cycle_zone_capacity capacity
JOIN delivery_cycle cycle ON cycle.id = capacity.cycle_id;

CREATE INDEX delivery_cycle_zone_active_idx
  ON delivery_cycle_zone(cycle_id, status, zone_id, location_id);

-- Historical Service Fee configurations and committed snapshots remain
-- queryable, while every existing and future configuration is explicitly
-- inactive for new commerce. Later runtime phases stop reading this table.
ALTER TABLE service_fee_configuration
  ADD COLUMN active_for_new_commerce INTEGER NOT NULL DEFAULT 0
  CHECK (active_for_new_commerce = 0);
