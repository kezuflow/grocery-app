import type { DeliveryDispatchItem } from "@freshmarkets/contracts";

type DispatchRow = Omit<DeliveryDispatchItem, "allowedActions"> & { cycleId: string | null };

export function allowedDeliveryActions(
  status: string,
  assigned: boolean,
): DeliveryDispatchItem["allowedActions"] {
  switch (status) {
    case "PENDING":
      return assigned ? ["DISPATCH"] : [];
    case "DISPATCHED":
      return ["DELIVER", "FAIL"];
    case "FAILED":
      return ["DISPATCH"];
    default:
      return [];
  }
}

/**
 * Location-scoped delivery dispatch board joined to the fulfillment record
 * that owns the location. Ordered so undelivered work surfaces first.
 */
export async function listDeliveryDispatch(
  database: D1Database,
  query: { locationId: string; cycleId?: string; cursorId?: string; limit?: number },
): Promise<Array<DispatchRow>> {
  const limit = query.limit ?? 200;
  const clauses = ["f.location_id=?", "d.status NOT IN ('CANCELED','DELIVERED')"];
  const binds: unknown[] = [query.locationId];
  if (query.cycleId) {
    clauses.push("o.cycle_id=?");
    binds.push(query.cycleId);
  }
  if (query.cursorId) {
    clauses.push("d.id<?");
    binds.push(query.cursorId);
  }
  const rows = await database
    .prepare(
      `SELECT d.id AS job_id, d.order_id, d.status, d.rider_user_id, d.address_snapshot_json, d.delivered_at, d.version, o.cycle_id FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id LEFT JOIN grocery_order o ON o.id=d.order_id WHERE ${clauses.join(" AND ")} ORDER BY d.id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      job_id: string;
      order_id: string;
      status: string;
      rider_user_id: string | null;
      address_snapshot_json: string;
      delivered_at: number | null;
      version: number;
      cycle_id: string | null;
    }>();
  return rows.results.map((r) => ({
    jobId: r.job_id,
    orderId: r.order_id,
    status: r.status,
    riderAuthUserId: r.rider_user_id,
    addressSnapshotJson: r.address_snapshot_json,
    deliveredAtIso: r.delivered_at === null ? null : new Date(r.delivered_at).toISOString(),
    version: r.version,
    cycleId: r.cycle_id,
  }));
}
