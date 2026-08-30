import type { EligibleRidersRequest, EligibleRiderView, RpcResult } from "@freshmarkets/contracts";
import { resolveDeliveryReadContext, type DeliveryMapReadDeps } from "./get-delivery-map";

export async function getEligibleRiders(
  deps: DeliveryMapReadDeps,
  request: EligibleRidersRequest,
): Promise<RpcResult<ReadonlyArray<EligibleRiderView>>> {
  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;
  const rows = await deps.db
    .prepare(
      `SELECT rider.id AS rider_id, rider.display_name,
              (
                SELECT COUNT(*) FROM delivery_batch batch
                WHERE batch.rider_id=rider.id
                  AND batch.context_resolution_status='RESOLVED'
                  AND batch.status NOT IN ('COMPLETED','CANCELED')
              ) AS open_batch_count,
              (
                SELECT COUNT(*) FROM delivery_job job
                WHERE job.rider_id=rider.id
                  AND job.context_resolution_status='RESOLVED'
                  AND job.status NOT IN ('DELIVERED','CANCELED','ESCALATED')
              ) AS open_delivery_count
       FROM rider_identity rider
       WHERE rider.status='ACTIVE'
         AND (rider.preferred_location_id IS NULL OR rider.preferred_location_id=?)
       ORDER BY rider.display_name ASC, rider.id ASC
       LIMIT 500`,
    )
    .bind(context.value.locationId)
    .all<{
      rider_id: string;
      display_name: string;
      open_batch_count: number;
      open_delivery_count: number;
    }>();
  return {
    ok: true,
    value: rows.results.map((row) => ({
      riderId: row.rider_id,
      displayName: row.display_name,
      openBatchCount: row.open_batch_count,
      openDeliveryCount: row.open_delivery_count,
    })),
    requestId: request.requestId,
  };
}
