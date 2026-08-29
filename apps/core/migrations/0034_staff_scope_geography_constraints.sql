CREATE TABLE staff_scope_new (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff_identity(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'market', 'location')),
  market_id TEXT REFERENCES market(id) ON DELETE RESTRICT,
  location_id TEXT REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  UNIQUE (staff_id, scope_kind, market_id, location_id),
  CHECK ((scope_kind = 'global' AND market_id IS NULL AND location_id IS NULL) OR
         (scope_kind = 'market' AND market_id IS NOT NULL AND location_id IS NULL) OR
         (scope_kind = 'location' AND market_id IS NULL AND location_id IS NOT NULL))
);

INSERT INTO staff_scope_new (id, staff_id, scope_kind, market_id, location_id)
SELECT id, staff_id, scope_kind, market_id, location_id FROM staff_scope;

DROP TABLE staff_scope;
ALTER TABLE staff_scope_new RENAME TO staff_scope;
CREATE INDEX staff_scope_staff_idx ON staff_scope(staff_id);
