import type { EligibleRiderPage, EligibleRidersRequest, RpcResult } from "@freshmarkets/contracts";
import { resolveDeliveryReadContext, type DeliveryMapReadDeps } from "./get-delivery-map";
import { decodeEligibleRiderCursor, encodeEligibleRiderCursor } from "./delivery-read-cursor";

const ELIGIBLE_RIDER_PAGE_SIZE = 200;

export async function getEligibleRiders(
  deps: DeliveryMapReadDeps,
  request: EligibleRidersRequest,
): Promise<RpcResult<EligibleRiderPage>> {
  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;
  if (
    request.cursor !== undefined &&
    (typeof request.cursor !== "string" ||
      request.cursor.length < 1 ||
      request.cursor.length > 1_024)
  ) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Pagination cursor is invalid",
        requestId: request.requestId,
      },
    };
  }
  const cursorScope = JSON.stringify(context.value);
  const cursor = request.cursor ? decodeEligibleRiderCursor(request.cursor, cursorScope) : null;
  if (request.cursor && !cursor) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Pagination cursor is invalid",
        requestId: request.requestId,
      },
    };
  }
  const cursorClause = cursor
    ? "AND (rider.display_name>? OR (rider.display_name=? AND rider.id>?))"
    : "";
  const bindings: unknown[] = [];
  if (cursor) bindings.push(cursor.name, cursor.name, cursor.id);
  bindings.push(ELIGIBLE_RIDER_PAGE_SIZE + 1);
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
         ${cursorClause}
       ORDER BY rider.display_name ASC, rider.id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<{
      rider_id: string;
      display_name: string;
      open_batch_count: number;
      open_delivery_count: number;
    }>();
  const pageRows = rows.results.slice(0, ELIGIBLE_RIDER_PAGE_SIZE);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.results.length > ELIGIBLE_RIDER_PAGE_SIZE && last
      ? encodeEligibleRiderCursor(cursorScope, last.display_name, last.rider_id)
      : null;
  return {
    ok: true,
    value: {
      riders: pageRows.map((row) => ({
        riderId: row.rider_id,
        displayName: row.display_name,
        openBatchCount: row.open_batch_count,
        openDeliveryCount: row.open_delivery_count,
      })),
      nextCursor,
      complete: nextCursor === null,
    },
    requestId: request.requestId,
  };
}
