/**
 * Procurement/receiving workbench for a location: requirement demand joined
 * to its receiving record so staff see expected vs accepted/rejected base
 * quantities and the guarded version for the next command.
 */
export type ProcurementWorkbenchItem = {
  requirementId: string;
  productName: string;
  productId: string | null;
  variantName: string | null;
  stockTracking: "SHARED" | "COUNTED_SIZES";
  cycleName: string;
  baseUnit: string;
  expectedQuantityBase: number;
  cycleId: string;
  locationId: string;
  inventoryPoolId: string;
  skuId: string | null;
  committedQuantitySellable: number | null;
  shippingWeightGrams: number | null;
  requiredQuantityBase: number;
  acceptedBase: number;
  legacyAcceptedBase: number;
  rejectedBase: number;
  shortageBase: number;
  replacementBase: number;
  replacementAllowed: boolean;
  requirementStatus: string;
  requirementVersion: number;
  receivingRecordId: string | null;
  receivingStatus: string | null;
  receivingVersion: number | null;
};

export async function listProcurementQueue(
  database: D1Database,
  query: {
    locationId: string;
    cycleId?: string;
    cursorId?: string;
    limit?: number;
    receivingOnly?: boolean;
  },
): Promise<Array<ProcurementWorkbenchItem>> {
  const limit = query.limit ?? 200;
  const clauses = ["pr.location_id=?"];
  const binds: unknown[] = [query.locationId];
  if (query.cycleId) {
    clauses.push("pr.delivery_cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursorId) {
    clauses.push("pr.id<?");
    binds.push(query.cursorId);
  }
  if (query.receivingOnly) clauses.push("rr.id IS NOT NULL");
  const rows = await database
    .prepare(
      `SELECT product.id product_id,sku.name variant_name,COALESCE(product.stock_tracking,'SHARED') stock_tracking,COALESCE(product.name,'Historical product') product_name,cycle.name cycle_name,unit.symbol base_unit,rr.expected_quantity,pr.id AS requirement_id, pr.delivery_cycle_id, pr.location_id, pr.inventory_pool_id,
       pr.sku_id,pr.committed_quantity_sellable,pr.shipping_weight_grams,
       pr.required_quantity, pr.status AS requirement_status, pr.version AS requirement_version,
       rr.id AS receiving_record_id, rr.accepted_quantity, rr.rejected_quantity, rr.legacy_accepted_base, rr.shortage_base, rr.replacement_base,
       rr.status AS receiving_status, rr.version AS receiving_version,
       EXISTS(SELECT 1 FROM supply_exception se WHERE se.requirement_id=pr.id AND se.status='OPEN' AND substr(se.id,1,length('receipt:'||rr.id||':'))='receipt:'||rr.id||':') tracked_discrepancy
       FROM procurement_requirement pr LEFT JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id
       JOIN delivery_cycle cycle ON cycle.id=pr.delivery_cycle_id
       JOIN inventory_pool pool ON pool.id=pr.inventory_pool_id
       JOIN unit ON unit.id=pool.base_unit_id
       LEFT JOIN sku ON sku.id=pr.sku_id
       LEFT JOIN product ON product.id=sku.product_id OR (pr.sku_id IS NULL AND product.inventory_pool_id=pool.id)
       WHERE ${clauses.join(" AND ")} ORDER BY pr.id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      requirement_id: string;
      product_name: string;
      product_id: string | null;
      variant_name: string | null;
      stock_tracking: "SHARED" | "COUNTED_SIZES";
      cycle_name: string;
      base_unit: string;
      expected_quantity: number | null;
      delivery_cycle_id: string;
      location_id: string;
      inventory_pool_id: string;
      sku_id: string | null;
      committed_quantity_sellable: number | null;
      shipping_weight_grams: number | null;
      required_quantity: number;
      requirement_status: string;
      requirement_version: number;
      receiving_record_id: string | null;
      accepted_quantity: number | null;
      legacy_accepted_base: number | null;
      rejected_quantity: number | null;
      shortage_base: number | null;
      replacement_base: number | null;
      tracked_discrepancy: number;
      receiving_status: string | null;
      receiving_version: number | null;
    }>();
  return rows.results.map((r) => ({
    requirementId: r.requirement_id,
    productName: r.product_name,
    productId: r.product_id,
    variantName: r.variant_name,
    stockTracking: r.stock_tracking,
    cycleName: r.cycle_name,
    baseUnit: r.base_unit,
    expectedQuantityBase: r.expected_quantity ?? r.required_quantity,
    cycleId: r.delivery_cycle_id,
    locationId: r.location_id,
    inventoryPoolId: r.inventory_pool_id,
    skuId: r.sku_id,
    committedQuantitySellable: r.committed_quantity_sellable,
    shippingWeightGrams: r.shipping_weight_grams,
    requiredQuantityBase: r.required_quantity,
    acceptedBase: r.accepted_quantity ?? 0,
    legacyAcceptedBase: r.legacy_accepted_base ?? 0,
    rejectedBase: r.rejected_quantity ?? 0,
    shortageBase: r.shortage_base ?? 0,
    replacementBase: r.replacement_base ?? 0,
    replacementAllowed: r.tracked_discrepancy === 1 && r.legacy_accepted_base === 0,
    requirementStatus: r.requirement_status,
    requirementVersion: r.requirement_version,
    receivingRecordId: r.receiving_record_id,
    receivingStatus: r.receiving_status,
    receivingVersion: r.receiving_version,
  }));
}
