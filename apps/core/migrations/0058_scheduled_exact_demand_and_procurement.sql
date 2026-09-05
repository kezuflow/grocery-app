-- Persist the exact line quantities required by Scheduled preorder commerce.
-- Nullable additions preserve historical pool-level demand while later
-- commands write EXACT_PAID_LINE records without stock/capacity netting.

ALTER TABLE sku
  ADD COLUMN estimated_shipping_weight_grams INTEGER
  CHECK (estimated_shipping_weight_grams IS NULL OR estimated_shipping_weight_grams > 0);

ALTER TABLE order_item
  ADD COLUMN base_unit_code_snapshot TEXT
  CHECK (
    base_unit_code_snapshot IS NULL OR
    base_unit_code_snapshot IN ('GRAM', 'MILLILITER', 'PIECE')
  );
ALTER TABLE order_item
  ADD COLUMN shipping_weight_grams INTEGER
  CHECK (shipping_weight_grams IS NULL OR shipping_weight_grams > 0);

ALTER TABLE paid_order_amendment_line
  ADD COLUMN base_unit_code_snapshot TEXT
  CHECK (
    base_unit_code_snapshot IS NULL OR
    base_unit_code_snapshot IN ('GRAM', 'MILLILITER', 'PIECE')
  );
ALTER TABLE paid_order_amendment_line
  ADD COLUMN shipping_weight_grams INTEGER
  CHECK (shipping_weight_grams IS NULL OR shipping_weight_grams > 0);

ALTER TABLE committed_demand
  ADD COLUMN demand_basis TEXT NOT NULL DEFAULT 'LEGACY_POOL_BASE'
  CHECK (demand_basis IN ('LEGACY_POOL_BASE', 'EXACT_PAID_LINE'));
ALTER TABLE committed_demand
  ADD COLUMN order_item_id TEXT REFERENCES order_item(id);
ALTER TABLE committed_demand
  ADD COLUMN sku_id TEXT REFERENCES sku(id);
ALTER TABLE committed_demand
  ADD COLUMN quantity_sellable INTEGER
  CHECK (quantity_sellable IS NULL OR quantity_sellable > 0);
ALTER TABLE committed_demand
  ADD COLUMN quantity_base_total INTEGER
  CHECK (quantity_base_total IS NULL OR quantity_base_total > 0);
ALTER TABLE committed_demand
  ADD COLUMN base_unit_code TEXT
  CHECK (base_unit_code IS NULL OR base_unit_code IN ('GRAM', 'MILLILITER', 'PIECE'));
ALTER TABLE committed_demand
  ADD COLUMN shipping_weight_grams INTEGER
  CHECK (shipping_weight_grams IS NULL OR shipping_weight_grams > 0);
ALTER TABLE committed_demand
  ADD COLUMN committed_at INTEGER;

CREATE UNIQUE INDEX committed_demand_exact_order_line_unique
  ON committed_demand(order_item_id)
  WHERE order_item_id IS NOT NULL;
CREATE INDEX committed_demand_exact_cycle_sku_idx
  ON committed_demand(
    delivery_cycle_id, location_id, sku_id, status, demand_basis, committed_at
  );

CREATE TRIGGER committed_demand_exact_insert_guard
BEFORE INSERT ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND NOT (
  NEW.order_item_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.quantity_sellable > 0
  AND NEW.quantity_base_total > 0
  AND NEW.quantity = NEW.quantity_base_total
  AND NEW.base_unit_code IS NOT NULL
  AND NEW.shipping_weight_grams > 0
  AND NEW.committed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_SCHEDULED_DEMAND');
END;

CREATE TRIGGER committed_demand_exact_update_guard
BEFORE UPDATE OF demand_basis, order_item_id, sku_id, quantity_sellable,
  quantity_base_total, quantity, base_unit_code, shipping_weight_grams, committed_at
ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND NOT (
  NEW.order_item_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.quantity_sellable > 0
  AND NEW.quantity_base_total > 0
  AND NEW.quantity = NEW.quantity_base_total
  AND NEW.base_unit_code IS NOT NULL
  AND NEW.shipping_weight_grams > 0
  AND NEW.committed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_SCHEDULED_DEMAND');
END;

CREATE TABLE procurement_run (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_cycle_id TEXT NOT NULL REFERENCES delivery_cycle(id) ON DELETE RESTRICT,
  destination_location_id TEXT NOT NULL
    REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN ('DRAFT', 'AGGREGATED', 'APPROVED', 'ORDERING', 'RECEIVING', 'CLOSED')
  ),
  demand_version INTEGER NOT NULL CHECK (demand_version > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (delivery_cycle_id, destination_location_id)
);

CREATE INDEX procurement_run_status_idx
  ON procurement_run(status, delivery_cycle_id, destination_location_id);

ALTER TABLE procurement_requirement
  ADD COLUMN procurement_run_id TEXT REFERENCES procurement_run(id);
ALTER TABLE procurement_requirement
  ADD COLUMN sku_id TEXT REFERENCES sku(id);
ALTER TABLE procurement_requirement
  ADD COLUMN calculation_basis TEXT NOT NULL DEFAULT 'LEGACY_COMPATIBILITY'
  CHECK (calculation_basis IN ('LEGACY_COMPATIBILITY', 'EXACT_PAID_DEMAND'));
ALTER TABLE procurement_requirement
  ADD COLUMN committed_quantity_sellable INTEGER
  CHECK (committed_quantity_sellable IS NULL OR committed_quantity_sellable > 0);
ALTER TABLE procurement_requirement
  ADD COLUMN committed_demand_base INTEGER
  CHECK (committed_demand_base IS NULL OR committed_demand_base > 0);
ALTER TABLE procurement_requirement
  ADD COLUMN shipping_weight_grams INTEGER
  CHECK (shipping_weight_grams IS NULL OR shipping_weight_grams > 0);
ALTER TABLE procurement_requirement
  ADD COLUMN required_base INTEGER
  CHECK (required_base IS NULL OR required_base > 0);
ALTER TABLE procurement_requirement
  ADD COLUMN approved_base INTEGER
  CHECK (approved_base IS NULL OR approved_base > 0);

CREATE UNIQUE INDEX procurement_requirement_run_sku_unique
  ON procurement_requirement(procurement_run_id, sku_id)
  WHERE procurement_run_id IS NOT NULL AND sku_id IS NOT NULL;

CREATE TRIGGER procurement_requirement_exact_insert_guard
BEFORE INSERT ON procurement_requirement
WHEN NEW.calculation_basis = 'EXACT_PAID_DEMAND' AND NOT (
  NEW.procurement_run_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.committed_quantity_sellable > 0
  AND NEW.committed_demand_base > 0
  AND NEW.shipping_weight_grams > 0
  AND NEW.required_base = NEW.committed_demand_base
  AND NEW.required_quantity = NEW.required_base
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_PROCUREMENT_REQUIREMENT');
END;

CREATE TRIGGER procurement_requirement_exact_update_guard
BEFORE UPDATE OF procurement_run_id, sku_id, calculation_basis,
  committed_quantity_sellable, committed_demand_base, shipping_weight_grams,
  required_base, required_quantity
ON procurement_requirement
WHEN NEW.calculation_basis = 'EXACT_PAID_DEMAND' AND NOT (
  NEW.procurement_run_id IS NOT NULL
  AND NEW.sku_id IS NOT NULL
  AND NEW.committed_quantity_sellable > 0
  AND NEW.committed_demand_base > 0
  AND NEW.shipping_weight_grams > 0
  AND NEW.required_base = NEW.committed_demand_base
  AND NEW.required_quantity = NEW.required_base
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_EXACT_PROCUREMENT_REQUIREMENT');
END;
