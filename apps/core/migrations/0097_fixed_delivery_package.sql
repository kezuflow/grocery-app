-- Shipping weight is optional reference metadata. Sold and base quantities
-- remain authoritative for exact Scheduled demand and procurement.
PRAGMA defer_foreign_keys=ON;

DROP TRIGGER committed_demand_exact_insert_guard;
DROP TRIGGER committed_demand_exact_update_guard;
DROP TRIGGER cycle_goods_receipt_evidence;

CREATE TABLE committed_demand_0097 (
  id TEXT NOT NULL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES grocery_order(id),
  delivery_cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN -9007199254740991 AND 9007199254740991),
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN -9007199254740991 AND 9007199254740991),
  demand_basis TEXT NOT NULL DEFAULT 'LEGACY_POOL_BASE' CHECK (demand_basis IN ('LEGACY_POOL_BASE','EXACT_PAID_LINE')),
  order_item_id TEXT REFERENCES order_item(id),
  sku_id TEXT REFERENCES sku(id),
  quantity_sellable INTEGER CHECK (quantity_sellable IS NULL OR quantity_sellable BETWEEN 1 AND 9007199254740991),
  quantity_base_total INTEGER CHECK (quantity_base_total IS NULL OR quantity_base_total BETWEEN 1 AND 9007199254740991),
  base_unit_code TEXT CHECK (base_unit_code IS NULL OR base_unit_code IN ('GRAM','MILLILITER','PIECE')),
  shipping_weight_grams INTEGER CHECK (shipping_weight_grams IS NULL OR shipping_weight_grams BETWEEN 1 AND 9007199254740991),
  committed_at INTEGER CHECK (committed_at IS NULL OR committed_at BETWEEN -9007199254740991 AND 9007199254740991),
  amendment_line_id TEXT REFERENCES paid_order_amendment_line(id),
  CHECK (NOT (demand_basis='EXACT_PAID_LINE') OR (
    (order_item_id IS NOT NULL)!=(amendment_line_id IS NOT NULL)
    AND sku_id IS NOT NULL AND quantity_sellable>0 AND quantity_base_total>0
    AND quantity=quantity_base_total AND base_unit_code IS NOT NULL
    AND (shipping_weight_grams IS NULL OR shipping_weight_grams>0)
    AND committed_at IS NOT NULL
  ) IS TRUE)
) STRICT;

INSERT INTO committed_demand_0097 (
  id, order_id, delivery_cycle_id, location_id, inventory_pool_id,
  quantity, status, version, demand_basis, order_item_id, sku_id,
  quantity_sellable, quantity_base_total, base_unit_code,
  shipping_weight_grams, committed_at, amendment_line_id
)
SELECT
  id, order_id, delivery_cycle_id, location_id, inventory_pool_id,
  quantity, status, version, demand_basis, order_item_id, sku_id,
  quantity_sellable, quantity_base_total, base_unit_code,
  shipping_weight_grams, committed_at, amendment_line_id
FROM committed_demand;

DROP TABLE committed_demand;
ALTER TABLE committed_demand_0097 RENAME TO committed_demand;

CREATE INDEX committed_demand_cycle_idx
  ON committed_demand(delivery_cycle_id, location_id, inventory_pool_id, status);
CREATE UNIQUE INDEX committed_demand_exact_amendment_line_unique
  ON committed_demand(amendment_line_id) WHERE amendment_line_id IS NOT NULL;
CREATE INDEX committed_demand_exact_cycle_sku_idx
  ON committed_demand(delivery_cycle_id, location_id, sku_id, status, demand_basis, committed_at);
CREATE UNIQUE INDEX committed_demand_exact_order_line_unique
  ON committed_demand(order_item_id) WHERE order_item_id IS NOT NULL;

CREATE TRIGGER committed_demand_exact_insert_guard
BEFORE INSERT ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND (
  (NEW.order_item_id IS NOT NULL) != (NEW.amendment_line_id IS NOT NULL)
  AND NEW.sku_id IS NOT NULL
  AND NEW.quantity_sellable > 0
  AND NEW.quantity_base_total > 0
  AND NEW.quantity = NEW.quantity_base_total
  AND NEW.base_unit_code IS NOT NULL
  AND (NEW.shipping_weight_grams IS NULL OR NEW.shipping_weight_grams > 0)
  AND NEW.committed_at IS NOT NULL
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_SCHEDULED_DEMAND');
END;

CREATE TABLE procurement_requirement_0097 (
  id TEXT NOT NULL PRIMARY KEY,
  delivery_cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  inventory_pool_id TEXT NOT NULL REFERENCES inventory_pool(id) ON DELETE RESTRICT,
  required_quantity INTEGER NOT NULL
    CHECK (required_quantity BETWEEN -9007199254740991 AND 9007199254740991),
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
    CHECK (version BETWEEN -9007199254740991 AND 9007199254740991),
  created_at INTEGER NOT NULL DEFAULT 0
    CHECK (created_at BETWEEN -9007199254740991 AND 9007199254740991),
  updated_at INTEGER NOT NULL DEFAULT 0
    CHECK (updated_at BETWEEN -9007199254740991 AND 9007199254740991),
  procurement_run_id TEXT REFERENCES procurement_run(id),
  sku_id TEXT REFERENCES sku(id),
  calculation_basis TEXT NOT NULL DEFAULT 'LEGACY_COMPATIBILITY'
    CHECK (calculation_basis IN ('LEGACY_COMPATIBILITY', 'EXACT_PAID_DEMAND')),
  committed_quantity_sellable INTEGER CHECK (
    committed_quantity_sellable IS NULL OR committed_quantity_sellable BETWEEN 1 AND 9007199254740991
  ),
  committed_demand_base INTEGER CHECK (
    committed_demand_base IS NULL OR committed_demand_base BETWEEN 1 AND 9007199254740991
  ),
  shipping_weight_grams INTEGER CHECK (
    shipping_weight_grams IS NULL OR shipping_weight_grams BETWEEN 1 AND 9007199254740991
  ),
  required_base INTEGER CHECK (
    required_base IS NULL OR required_base BETWEEN 1 AND 9007199254740991
  ),
  approved_base INTEGER CHECK (
    approved_base IS NULL OR approved_base BETWEEN 1 AND 9007199254740991
  ),
  CHECK (NOT (calculation_basis = 'EXACT_PAID_DEMAND') OR ((
    procurement_run_id IS NOT NULL
    AND sku_id IS NOT NULL
    AND committed_quantity_sellable > 0
    AND committed_demand_base > 0
    AND (shipping_weight_grams IS NULL OR shipping_weight_grams > 0)
    AND required_base = committed_demand_base
    AND required_quantity = required_base
  )) IS TRUE)
) STRICT;

INSERT INTO procurement_requirement_0097 (
  id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity,
  status, version, created_at, updated_at, procurement_run_id, sku_id,
  calculation_basis, committed_quantity_sellable, committed_demand_base,
  shipping_weight_grams, required_base, approved_base
)
SELECT
  id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity,
  status, version, created_at, updated_at, procurement_run_id, sku_id,
  calculation_basis, committed_quantity_sellable, committed_demand_base,
  shipping_weight_grams, required_base, approved_base
FROM procurement_requirement;

DROP TABLE procurement_requirement;
ALTER TABLE procurement_requirement_0097 RENAME TO procurement_requirement;

CREATE INDEX procurement_requirement_cycle_idx
  ON procurement_requirement(delivery_cycle_id, location_id, inventory_pool_id, status);
CREATE UNIQUE INDEX procurement_requirement_run_sku_unique
  ON procurement_requirement(procurement_run_id, sku_id)
  WHERE procurement_run_id IS NOT NULL AND sku_id IS NOT NULL;

CREATE TRIGGER committed_demand_exact_update_guard
BEFORE UPDATE OF demand_basis, order_item_id, amendment_line_id, sku_id,
  quantity_sellable, quantity_base_total, quantity, base_unit_code,
  shipping_weight_grams, committed_at
ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND (
  (NEW.order_item_id IS NOT NULL) != (NEW.amendment_line_id IS NOT NULL)
  AND NEW.sku_id IS NOT NULL
  AND NEW.quantity_sellable > 0
  AND NEW.quantity_base_total > 0
  AND NEW.quantity = NEW.quantity_base_total
  AND NEW.base_unit_code IS NOT NULL
  AND (NEW.shipping_weight_grams IS NULL OR NEW.shipping_weight_grams > 0)
  AND NEW.committed_at IS NOT NULL
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_SCHEDULED_DEMAND');
END;

CREATE TRIGGER procurement_requirement_canonical_status_insert
BEFORE INSERT ON procurement_requirement
WHEN NEW.status NOT IN (
  'OPEN','AGGREGATED','REQUIREMENT_APPROVED','ORDERED',
  'PARTIALLY_RECEIVED','RECEIVED','CLOSED','EXCEPTION'
)
BEGIN SELECT RAISE(ABORT, 'INVALID_PROCUREMENT_STATUS'); END;

CREATE TRIGGER procurement_requirement_canonical_status_update
BEFORE UPDATE OF status ON procurement_requirement
WHEN NEW.status NOT IN (
  'OPEN','AGGREGATED','REQUIREMENT_APPROVED','ORDERED',
  'PARTIALLY_RECEIVED','RECEIVED','CLOSED','EXCEPTION'
)
BEGIN SELECT RAISE(ABORT, 'INVALID_PROCUREMENT_STATUS'); END;

CREATE TRIGGER procurement_requirement_exact_insert_guard
BEFORE INSERT ON procurement_requirement
WHEN NEW.calculation_basis = 'EXACT_PAID_DEMAND' AND (
  NEW.procurement_run_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.committed_quantity_sellable > 0
  AND NEW.committed_demand_base > 0
  AND (NEW.shipping_weight_grams IS NULL OR NEW.shipping_weight_grams > 0)
  AND NEW.required_base = NEW.committed_demand_base
  AND NEW.required_quantity = NEW.required_base
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_PROCUREMENT_REQUIREMENT');
END;

CREATE TRIGGER procurement_requirement_exact_update_guard
BEFORE UPDATE OF procurement_run_id, sku_id, calculation_basis,
  committed_quantity_sellable, committed_demand_base, shipping_weight_grams,
  required_base, required_quantity
ON procurement_requirement
WHEN NEW.calculation_basis = 'EXACT_PAID_DEMAND' AND (
  NEW.procurement_run_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.committed_quantity_sellable > 0
  AND NEW.committed_demand_base > 0
  AND (NEW.shipping_weight_grams IS NULL OR NEW.shipping_weight_grams > 0)
  AND NEW.required_base = NEW.committed_demand_base
  AND NEW.required_quantity = NEW.required_base
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_PROCUREMENT_REQUIREMENT');
END;

CREATE TRIGGER cycle_goods_receipt_evidence
BEFORE INSERT ON cycle_goods_movement
WHEN NEW.receiving_event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM receiving_event event
  JOIN procurement_requirement requirement
    ON requirement.id = event.procurement_requirement_id
  WHERE event.id = NEW.receiving_event_id
    AND event.location_id = NEW.location_id
    AND event.inventory_pool_id = NEW.inventory_pool_id
    AND event.accepted_delta = NEW.quantity_base
    AND requirement.delivery_cycle_id = NEW.cycle_id
)
BEGIN SELECT RAISE(ABORT, 'INVALID_CYCLE_RECEIPT_EVIDENCE'); END;

PRAGMA defer_foreign_keys=OFF;
