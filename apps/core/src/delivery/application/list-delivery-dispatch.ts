type DispatchRow = {
  jobId: string;
  orderId: string;
  status: string;
  deliveredAtIso: string | null;
  version: number;
  cycleId: string | null;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  addressSnapshotJson: string;
  externalProvider: "lalamove" | "grab-express" | null;
  externalDispatchId: string | null;
  externalStatus: string | null;
  externalTrackingUrl: string | null;
  externalVersion: number | null;
};

/**
 * Location-scoped delivery dispatch board joined to the fulfillment record
 * that owns the location. Ordered so undelivered work surfaces first.
 */
export async function listDeliveryDispatch(
  database: D1Database,
  query: { locationId: string; cycleId?: string; cursorId?: string; limit?: number },
): Promise<Array<DispatchRow>> {
  const limit = query.limit ?? 200;
  const clauses = ["f.location_id=?", "d.status NOT IN ('CANCELED','DELIVERED','ESCALATED')"];
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
      `SELECT d.id AS job_id,d.order_id,d.status,d.address_snapshot_json,
              d.delivered_at,d.version,o.cycle_id,d.fulfillment_mode,
              dispatch.id AS external_dispatch_id,dispatch.provider AS external_provider,
              dispatch.status AS external_status,dispatch.tracking_url AS external_tracking_url,
              dispatch.version AS external_version
       FROM delivery_job d JOIN fulfillment_record f ON f.order_id=d.order_id
       LEFT JOIN grocery_order o ON o.id=d.order_id
       LEFT JOIN delivery_provider_dispatch dispatch ON dispatch.delivery_job_id=d.id
       WHERE ${clauses.join(" AND ")} ORDER BY d.id DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<{
      job_id: string;
      order_id: string;
      status: string;
      address_snapshot_json: string;
      delivered_at: number | null;
      version: number;
      cycle_id: string | null;
      fulfillment_mode: "INSTANT" | "SCHEDULED";
      external_provider: "lalamove" | "grab-express" | null;
      external_dispatch_id: string | null;
      external_status: string | null;
      external_tracking_url: string | null;
      external_version: number | null;
    }>();
  return rows.results.map((r) => ({
    jobId: r.job_id,
    orderId: r.order_id,
    status: r.status,
    addressSnapshotJson: r.address_snapshot_json,
    deliveredAtIso: r.delivered_at === null ? null : new Date(r.delivered_at).toISOString(),
    version: r.version,
    cycleId: r.cycle_id,
    fulfillmentMode: r.fulfillment_mode,
    externalProvider: r.external_provider,
    externalDispatchId: r.external_dispatch_id,
    externalStatus: r.external_status,
    externalTrackingUrl: r.external_tracking_url,
    externalVersion: r.external_version,
  }));
}
