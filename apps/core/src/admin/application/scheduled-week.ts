import type {
  RpcResult,
  ScheduledWeekRequest,
  ScheduledWeekView,
  ScheduledDemandItem,
} from "@freshmarkets/contracts";
import {
  hasUnresolvedScheduledCommitment,
  scheduledPurchasePendingMessage,
} from "../../payments/infrastructure/d1/scheduled-commitment-readiness";
import { scheduledWeekQuerySchema, scheduledWeekViewSchema } from "@freshmarkets/validation";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

/** A bounded operational projection; Orders, demand, receiving and catalog keep their own authority. */
export async function getAdminScheduledWeek(
  deps: OperationsAdministrationDeps,
  input: ScheduledWeekRequest,
): Promise<RpcResult<ScheduledWeekView>> {
  const parsed = scheduledWeekQuerySchema.safeParse(input);
  const fail = (code: "VALIDATION_FAILED" | "NOT_FOUND", message: string) => ({
    ok: false as const,
    error: { code, message, requestId: input.requestId },
  });
  if (!parsed.success) return fail("VALIDATION_FAILED", "Select a location and delivery week");
  const query = parsed.data;
  const permitted = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "procurement.read",
    query.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!permitted.ok) return permitted;
  const locationCycles = `FROM delivery_cycle c JOIN fulfillment_location l ON l.market_id=c.market_id AND l.id=?
    WHERE (EXISTS(SELECT 1 FROM delivery_cycle_zone z WHERE z.cycle_id=c.id AND z.location_id=l.id)
      OR EXISTS(SELECT 1 FROM committed_demand d WHERE d.delivery_cycle_id=c.id AND d.location_id=l.id))`;
  const cycles = await deps.db
    .prepare(
      `SELECT c.id cycleId,c.name,c.status ${locationCycles} AND c.id>? ORDER BY c.id LIMIT 21`,
    )
    .bind(query.locationId, query.cycleCursor ?? "")
    .all<ScheduledWeekView["cycles"][number]>();
  const result: ScheduledWeekView = {
    cycles: cycles.results.slice(0, 20),
    nextCycleCursor: cycles.results.length > 20 ? (cycles.results[19]?.cycleId ?? null) : null,
    week: null,
    page: { kind: "DEMAND", items: [], nextCursor: null },
  };
  if (!query.cycleId) return { ok: true, value: result, requestId: input.requestId };
  const selected = await deps.db
    .prepare(
      `SELECT c.id cycleId,c.name,c.status,c.order_opens_at orderOpensAt,c.cutoff_at cutoffAt ${locationCycles} AND c.id=?`,
    )
    .bind(query.locationId, query.cycleId)
    .first<{
      cycleId: string;
      name: string;
      status: string;
      orderOpensAt: number;
      cutoffAt: number;
    }>();
  if (!selected) return fail("NOT_FOUND", "Delivery week not found at this location");
  const [schedule, windows] = await Promise.all([
    deps.db
      .prepare(`SELECT COALESCE(s.timezone,m.timezone) timezone,s.procurement_at procurementAt,s.preparation_at preparationAt,s.pickup_at pickupAt
      FROM delivery_cycle c JOIN market m ON m.id=c.market_id LEFT JOIN delivery_cycle_schedule s ON s.cycle_id=c.id WHERE c.id=?`)
      .bind(query.cycleId)
      .first<{
        timezone: string;
        procurementAt: number | null;
        preparationAt: number | null;
        pickupAt: number | null;
      }>(),
    deps.db
      .prepare(
        "SELECT name,starts_at startsAt,ends_at endsAt FROM delivery_cycle_window WHERE cycle_id=? ORDER BY starts_at,id LIMIT 100",
      )
      .bind(query.cycleId)
      .all<{ name: string; startsAt: number; endsAt: number }>(),
  ]);
  if (!schedule) return fail("NOT_FOUND", "Delivery week schedule is unavailable");
  const purchasePending = await hasUnresolvedScheduledCommitment(deps.db, query.cycleId);
  result.week = {
    ...selected,
    ...schedule,
    windows: windows.results,
    purchaseBlockedReason: purchasePending ? scheduledPurchasePendingMessage : null,
  };
  const now = Date.now();
  if (query.section === "DEMAND") {
    const manage = await resolveOperationsAdministrationAccess(
      deps,
      input,
      "procurement.manage",
      query.locationId,
    );
    const rows = await deps.db
      .prepare(`WITH demand AS (
      SELECT sku_id,inventory_pool_id,SUM(quantity_sellable) quantitySellable,SUM(quantity_base_total) quantityBase,SUM(shipping_weight_grams) shippingGrams,MIN(base_unit_code) baseUnit
      FROM committed_demand WHERE delivery_cycle_id=? AND location_id=? AND status='OPEN' AND demand_basis='EXACT_PAID_LINE' GROUP BY sku_id,inventory_pool_id
    ) SELECT d.sku_id skuId,d.inventory_pool_id inventoryPoolId,p.name productName,s.name variantName,d.quantitySellable,d.quantityBase,d.shippingGrams,d.baseUnit,
      pr.id requirementId,COALESCE(pr.version,0) requirementVersion,COALESCE(pr.status,'NOT_PURCHASED') status,
      COALESCE(rr.accepted_quantity,0) acceptedBase,COALESCE(rr.rejected_quantity,0) rejectedBase,COALESCE(rr.shortage_base,0) shortageBase,COALESCE(rr.replacement_base,0) replacementBase,rr.status receivingStatus
      FROM demand d JOIN sku s ON s.id=d.sku_id JOIN product p ON p.id=s.product_id
      LEFT JOIN procurement_run run ON run.delivery_cycle_id=? AND run.destination_location_id=?
      LEFT JOIN procurement_requirement pr ON pr.procurement_run_id=run.id AND pr.sku_id=d.sku_id
      LEFT JOIN receiving_record rr ON rr.procurement_requirement_id=pr.id
      WHERE d.sku_id>? ORDER BY d.sku_id LIMIT 51`)
      .bind(query.cycleId, query.locationId, query.cycleId, query.locationId, query.cursor ?? "")
      .all<Omit<ScheduledDemandItem, "canConfirmPurchase">>();
    result.page = {
      kind: "DEMAND",
      items: rows.results.slice(0, 50).map((row) => ({
        ...row,
        canConfirmPurchase:
          !purchasePending &&
          manage.ok &&
          selected.cutoffAt <= now &&
          !["DRAFT", "SCHEDULED", "CLOSED", "CANCELED"].includes(selected.status) &&
          ["NOT_PURCHASED", "AGGREGATED"].includes(row.status),
      })),
      nextCursor: rows.results.length > 50 ? (rows.results[49]?.skuId ?? null) : null,
    };
  } else if (query.section === "ORDERS") {
    const access = await resolveOperationsAdministrationAccess(
      deps,
      input,
      "fulfillment.read",
      query.locationId,
    );
    if (!access.ok) result.page = { kind: "ORDERS", denied: true, items: [], nextCursor: null };
    else {
      const rows = await deps.db
        .prepare(`SELECT o.id orderId,o.status,f.status preparationStatus FROM grocery_order o
        LEFT JOIN fulfillment_record f ON f.order_id=o.id AND f.location_id=? WHERE o.cycle_id=?
        AND EXISTS(SELECT 1 FROM committed_demand d WHERE d.order_id=o.id AND d.location_id=?) AND o.id>? ORDER BY o.id LIMIT 51`)
        .bind(query.locationId, query.cycleId, query.locationId, query.cursor ?? "")
        .all<{ orderId: string; status: string; preparationStatus: string | null }>();
      result.page = {
        kind: "ORDERS",
        denied: false,
        items: rows.results.slice(0, 50),
        nextCursor: rows.results.length > 50 ? (rows.results[49]?.orderId ?? null) : null,
      };
    }
  } else {
    const rows = await deps.db
      .prepare(`SELECT s.id skuId,p.name productName,s.name variantName,
      (SELECT pv.amount_minor FROM price_version pv WHERE pv.sku_id=s.id AND pv.market_id=(SELECT market_id FROM fulfillment_location WHERE id=a.location_id) AND pv.location_id=? AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1) priceMinor,
      (SELECT pv.currency FROM price_version pv WHERE pv.sku_id=s.id AND pv.market_id=(SELECT market_id FROM fulfillment_location WHERE id=a.location_id) AND pv.location_id=? AND pv.valid_from<=? AND (pv.valid_to IS NULL OR pv.valid_to>?) ORDER BY pv.version DESC LIMIT 1) currency
      FROM sku s JOIN product p ON p.id=s.product_id JOIN sku_location_availability a ON a.sku_id=s.id AND a.location_id=?
      WHERE s.status='active' AND p.status='active' AND a.availability_status='AVAILABLE' AND s.id>? ORDER BY s.id LIMIT 51`)
      .bind(
        query.locationId,
        now,
        now,
        query.locationId,
        now,
        now,
        query.locationId,
        query.cursor ?? "",
      )
      .all<{
        skuId: string;
        productName: string;
        variantName: string;
        priceMinor: number | null;
        currency: string | null;
      }>();
    result.page = {
      kind: "OFFERS",
      items: rows.results.slice(0, 50),
      nextCursor: rows.results.length > 50 ? (rows.results[49]?.skuId ?? null) : null,
    };
  }
  return { ok: true, value: scheduledWeekViewSchema.parse(result), requestId: input.requestId };
}
