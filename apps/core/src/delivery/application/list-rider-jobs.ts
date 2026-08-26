import type { RiderJobsValue } from "@freshmarkets/contracts";
import { allowedDeliveryActions } from "./list-delivery-dispatch";

/**
 * Open delivery jobs assigned to one rider (by auth user id). Riders see
 * only their own assignments; unassigned jobs belong to the dispatch board,
 * never to a rider console.
 */
export async function listRiderJobs(
  database: D1Database,
  query: { riderAuthUserId: string },
): Promise<RiderJobsValue["jobs"]> {
  const rows = await database
    .prepare(
      "SELECT id AS job_id, order_id, status, address_snapshot_json, version FROM delivery_job WHERE rider_user_id=? AND status IN ('PENDING','DISPATCHED','FAILED') ORDER BY CASE status WHEN 'DISPATCHED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END, version ASC, rowid ASC LIMIT 100",
    )
    .bind(query.riderAuthUserId)
    .all<{
      job_id: string;
      order_id: string;
      status: string;
      address_snapshot_json: string;
      version: number;
    }>();
  return rows.results.map((r) => ({
    jobId: r.job_id,
    orderId: r.order_id,
    status: r.status,
    addressSnapshotJson: r.address_snapshot_json,
    version: r.version,
    allowedActions: allowedDeliveryActions(r.status, true),
  }));
}
