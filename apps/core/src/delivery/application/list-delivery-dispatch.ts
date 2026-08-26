import type { DeliveryDispatchItem } from "@freshmarkets/contracts";

type DispatchRow = Omit<DeliveryDispatchItem, "allowedActions">;

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
  query: { locationId: string },
): Promise<Array<DispatchRow>> {
  const rows = await database
    .prepare(
      "SELECT d.id AS job_id, d.order_id, d.status, d.rider_user_id, d.address_snapshot_json, d.delivered_at, d.version FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id WHERE f.location_id=? AND d.status NOT IN ('CANCELED','DELIVERED') ORDER BY d.status ASC, d.version ASC, d.rowid ASC LIMIT 200",
    )
    .bind(query.locationId)
    .all<{
      job_id: string;
      order_id: string;
      status: string;
      rider_user_id: string | null;
      address_snapshot_json: string;
      delivered_at: number | null;
      version: number;
    }>();
  return rows.results.map((r) => ({
    jobId: r.job_id,
    orderId: r.order_id,
    status: r.status,
    riderAuthUserId: r.rider_user_id,
    addressSnapshotJson: r.address_snapshot_json,
    deliveredAtIso: r.delivered_at === null ? null : new Date(r.delivered_at).toISOString(),
    version: r.version,
  }));
}
