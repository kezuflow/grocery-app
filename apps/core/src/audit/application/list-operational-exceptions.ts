import type { OperationalExceptionItem } from "@freshmarkets/contracts";

export type OperationalExceptionProjection = OperationalExceptionItem & { queueKey: string };

function ageMinutes(at: number | null, now: number): number | null {
  if (at === null || !Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

function severity(quantity: number): OperationalExceptionItem["severity"] {
  if (quantity >= 1000) return "CRITICAL";
  if (quantity > 0) return "HIGH";
  return "MEDIUM";
}

function queueKey(at: number | null, source: string, id: string): string {
  return `${String(at ?? 0).padStart(13, "0")}:${source}:${id}`;
}

/** Derived queue projection; source aggregates remain authoritative for writes. */
export async function listOperationalExceptions(
  database: D1Database,
  query: { locationId: string; cursorKey?: string; limit?: number },
): Promise<Array<OperationalExceptionProjection>> {
  const now = Date.now();
  const [procurement, shortages, deliveries, receiving] = await Promise.all([
    database
      .prepare(
        "SELECT se.id, se.kind, se.affected_quantity, se.created_at, pr.location_id FROM supply_exception se JOIN procurement_requirement pr ON pr.id=se.requirement_id WHERE pr.location_id=? AND se.status NOT IN ('RESOLVED','CLOSED') AND (? IS NULL OR (printf('%013d', se.created_at)||':PROCUREMENT:'||se.id) < ?) ORDER BY se.created_at DESC, se.id DESC LIMIT ?",
      )
      .bind(query.locationId, query.cursorKey ?? null, query.cursorKey ?? null, query.limit ?? 51)
      .all<{
        id: string;
        kind: string;
        affected_quantity: number;
        created_at: number;
        location_id: string;
      }>(),
    database
      .prepare(
        "SELECT id, order_id, status, updated_at FROM fulfillment_record WHERE location_id=? AND status='SHORTAGE' AND (? IS NULL OR (printf('%013d', updated_at)||':FULFILLMENT:'||id) < ?) ORDER BY updated_at DESC, id DESC LIMIT ?",
      )
      .bind(query.locationId, query.cursorKey ?? null, query.cursorKey ?? null, query.limit ?? 51)
      .all<{ id: string; order_id: string; status: string; updated_at: number }>(),
    database
      .prepare(
        "SELECT d.id, d.order_id, d.status, d.rider_user_id, f.updated_at FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id WHERE f.location_id=? AND d.status='FAILED' AND (? IS NULL OR (printf('%013d', f.updated_at)||':DELIVERY:'||d.id) < ?) ORDER BY f.updated_at DESC, d.id DESC LIMIT ?",
      )
      .bind(query.locationId, query.cursorKey ?? null, query.cursorKey ?? null, query.limit ?? 51)
      .all<{
        id: string;
        order_id: string;
        status: string;
        rider_user_id: string | null;
        updated_at: number;
      }>(),
    database
      .prepare(
        "SELECT rr.id, rr.expected_quantity, rr.accepted_quantity, rr.rejected_quantity, pr.location_id, rr.rowid AS source_rowid FROM receiving_record rr JOIN procurement_requirement pr ON pr.id=rr.procurement_requirement_id WHERE pr.location_id=? AND (rr.rejected_quantity>0 OR rr.accepted_quantity+rr.rejected_quantity NOT IN (0, rr.expected_quantity)) AND rr.status!='PENDING' AND (? IS NULL OR (printf('%013d', rr.rowid)||':RECEIVING:'||rr.id) < ?) ORDER BY rr.rowid DESC, rr.id DESC LIMIT ?",
      )
      .bind(query.locationId, query.cursorKey ?? null, query.cursorKey ?? null, query.limit ?? 51)
      .all<{
        id: string;
        expected_quantity: number;
        accepted_quantity: number;
        rejected_quantity: number;
        location_id: string;
        source_rowid: number;
      }>(),
  ]);
  const rows: OperationalExceptionProjection[] = [
    ...procurement.results.map((r) => ({
      kind: "PROCUREMENT_SHORTAGE" as const,
      source: "PROCUREMENT" as const,
      severity: severity(r.affected_quantity),
      ageMinutes: ageMinutes(r.created_at, now),
      ownerId: null,
      referenceId: r.id,
      orderId: null,
      locationId: r.location_id,
      reason: r.kind,
      permittedActions: [],
      queueKey: queueKey(r.created_at, "PROCUREMENT", r.id),
      detail: `Procurement shortage (${r.kind}); ${r.affected_quantity} base units affected.`,
    })),
    ...receiving.results.map((r) => ({
      kind: "RECEIVING_DISCREPANCY" as const,
      source: "RECEIVING" as const,
      severity: r.rejected_quantity > 0 ? ("HIGH" as const) : ("MEDIUM" as const),
      ageMinutes: null,
      ownerId: null,
      referenceId: r.id,
      orderId: null,
      locationId: r.location_id,
      reason: "RECEIVING_DISCREPANCY",
      permittedActions: [],
      queueKey: queueKey(r.source_rowid, "RECEIVING", r.id),
      detail: `Expected ${r.expected_quantity}, accepted ${r.accepted_quantity}, rejected ${r.rejected_quantity}.`,
    })),
    ...shortages.results.map((r) => ({
      kind: "FULFILLMENT_SHORTAGE" as const,
      source: "FULFILLMENT" as const,
      severity: "HIGH" as const,
      ageMinutes: ageMinutes(r.updated_at, now),
      ownerId: null,
      referenceId: r.id,
      orderId: r.order_id,
      locationId: query.locationId,
      reason: "FULFILLMENT_SHORTAGE",
      permittedActions: ["RETRY_FULFILLMENT"] as const,
      queueKey: queueKey(r.updated_at, "FULFILLMENT", r.id),
      detail: `Fulfillment ${r.status}; resolve or restock before packing.`,
    })),
    ...deliveries.results.map((r) => ({
      kind: "DELIVERY_FAILED" as const,
      source: "DELIVERY" as const,
      severity: "HIGH" as const,
      ageMinutes: ageMinutes(r.updated_at, now),
      ownerId: r.rider_user_id,
      referenceId: r.id,
      orderId: r.order_id,
      locationId: query.locationId,
      reason: "DELIVERY_FAILED",
      permittedActions: ["RETRY_DELIVERY"] as const,
      queueKey: queueKey(r.updated_at, "DELIVERY", r.id),
      detail: "Failed delivery; retry from the delivery queue.",
    })),
  ];
  // Match SQLite's binary TEXT comparison used by the cursor predicates.
  return rows.sort((a, b) => (a.queueKey === b.queueKey ? 0 : a.queueKey < b.queueKey ? 1 : -1));
}
