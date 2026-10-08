import type {
  RpcResult,
  SupplierPurchaseList,
  SupplierPurchaseListRequest,
} from "@freshmarkets/contracts";
import {
  supplierPurchaseListQuerySchema,
  supplierPurchaseListSchema,
} from "@freshmarkets/validation";
import { scheduledPurchaseQuantity } from "../domain/scheduled-purchase-quantity";
import { scheduledPaidLinesSql } from "./scheduled-week";
import {
  resolveOperationsAdministrationAccess,
  resolveGlobalOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

export async function getAdminSupplierPurchaseList(
  deps: OperationsAdministrationDeps,
  input: SupplierPurchaseListRequest,
): Promise<RpcResult<SupplierPurchaseList>> {
  const parsed = supplierPurchaseListQuerySchema.safeParse(input);
  const fail = (code: "VALIDATION_FAILED" | "NOT_FOUND", message: string) => ({
    ok: false as const,
    error: { code, message, requestId: input.requestId },
  });
  if (!parsed.success) return fail("VALIDATION_FAILED", "Select a delivery week to export");
  const { cycleId, locationId } = parsed.data;
  const access = locationId
    ? await resolveOperationsAdministrationAccess(deps, input, "procurement.read", locationId, {
        concealOutOfScopeLocation: true,
      })
    : await resolveGlobalOperationsAdministrationAccess(deps, input, "procurement.read");
  if (!access.ok) return access;
  const cycle = await deps.db
    .prepare(`SELECT c.name cycleName,
    CASE WHEN ? IS NULL THEN 'All fulfillment locations' ELSE (SELECT name FROM fulfillment_location WHERE id=?) END scopeName
    FROM delivery_cycle c WHERE c.id=? AND (
      EXISTS(SELECT 1 FROM delivery_cycle_zone z JOIN fulfillment_location l ON l.id=z.location_id WHERE z.cycle_id=c.id AND (? IS NULL OR (l.id=? AND l.market_id=c.market_id)))
      OR EXISTS(SELECT 1 FROM committed_demand d JOIN fulfillment_location l ON l.id=d.location_id WHERE d.delivery_cycle_id=c.id AND (? IS NULL OR (l.id=? AND l.market_id=c.market_id))))`)
    .bind(
      locationId ?? null,
      locationId ?? null,
      cycleId,
      locationId ?? null,
      locationId ?? null,
      locationId ?? null,
      locationId ?? null,
    )
    .first<{ cycleName: string; scopeName: string }>();
  if (!cycle) return fail("NOT_FOUND", "Delivery week not found at this location");
  // One complete read of the paid source, independent of the UI's cursor or selected tab.
  const rows = await deps.db
    .prepare(`WITH paid_lines AS (${scheduledPaidLinesSql})
    SELECT product_id productId,productName,inventory_pool_id inventoryPoolId,variantName,base_unit_code baseUnit,
      SUM(quantity_sellable) soldUnitCount,SUM(quantity_base_total) totalQuantityBase
    FROM paid_lines GROUP BY product_id,productName,inventory_pool_id,variantName,base_unit_code
    ORDER BY productName,product_id,inventory_pool_id,variantName,base_unit_code LIMIT 5001`)
    .bind(cycleId, locationId ?? null, locationId ?? null)
    .all<{
      productId: string;
      productName: string;
      inventoryPoolId: string;
      variantName: string;
      baseUnit: "GRAM" | "MILLILITER" | "PIECE";
      soldUnitCount: number;
      totalQuantityBase: number;
    }>();
  if (rows.results.length > 5000)
    return fail(
      "VALIDATION_FAILED",
      "This supplier list exceeds 5,000 quantity groups. Export a fulfillment location separately.",
    );
  const quantities = new Map<string, SupplierPurchaseList["items"][number]>();
  for (const row of rows.results) {
    const quantity = scheduledPurchaseQuantity(row);
    const key = JSON.stringify([
      row.productId,
      row.productName,
      row.inventoryPoolId,
      quantity.sizeLabel,
      quantity.unit,
    ]);
    const previous = quantities.get(key);
    quantities.set(key, {
      productName: row.productName,
      ...quantity,
      quantity: quantity.quantity + (previous?.quantity ?? 0),
    });
  }
  return {
    ok: true,
    value: supplierPurchaseListSchema.parse({
      ...cycle,
      generatedAt: Date.now(),
      items: [...quantities.values()],
    }),
    requestId: input.requestId,
  };
}
