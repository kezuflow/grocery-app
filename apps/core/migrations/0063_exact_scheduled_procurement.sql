-- Complete exact Scheduled demand for paid additions and remove the legacy
-- pool-level single-active constraint. Scheduled procurement is one exact
-- requirement per paid SKU within a cycle/location run.

ALTER TABLE committed_demand
  ADD COLUMN amendment_line_id TEXT REFERENCES paid_order_amendment_line(id);

DROP TRIGGER committed_demand_exact_insert_guard;
DROP TRIGGER committed_demand_exact_update_guard;

CREATE UNIQUE INDEX committed_demand_exact_amendment_line_unique
  ON committed_demand(amendment_line_id)
  WHERE amendment_line_id IS NOT NULL;

CREATE TRIGGER committed_demand_exact_insert_guard
BEFORE INSERT ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND NOT (
  (NEW.order_item_id IS NOT NULL) != (NEW.amendment_line_id IS NOT NULL)
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
BEFORE UPDATE OF demand_basis, order_item_id, amendment_line_id, sku_id,
  quantity_sellable, quantity_base_total, quantity, base_unit_code,
  shipping_weight_grams, committed_at
ON committed_demand
WHEN NEW.demand_basis = 'EXACT_PAID_LINE' AND NOT (
  (NEW.order_item_id IS NOT NULL) != (NEW.amendment_line_id IS NOT NULL)
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

DROP INDEX procurement_requirement_active_context_unique;

CREATE UNIQUE INDEX procurement_requirement_active_run_sku_unique
  ON procurement_requirement(procurement_run_id, sku_id)
  WHERE status != 'CLOSED'
    AND procurement_run_id IS NOT NULL
    AND sku_id IS NOT NULL;
