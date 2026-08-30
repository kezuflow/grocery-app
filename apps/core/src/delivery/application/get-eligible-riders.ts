import type { EligibleRiderPage, EligibleRidersRequest, RpcResult } from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import { resolveDeliveryReadContext, type DeliveryMapReadDeps } from "./get-delivery-map";
import { decodeEligibleRiderCursor, encodeEligibleRiderCursor } from "./delivery-read-cursor";

const ELIGIBLE_RIDER_PAGE_SIZE = 200;
const ELIGIBLE_RIDER_PROJECTION_ITEM_LIMIT = 2_000;

type EligibleRiderRow = {
  rider_id: string;
  display_name: string;
  version: number;
  updated_at: number;
  open_batch_count: number;
  open_delivery_count: number;
};

const ELIGIBLE_RIDER_SELECT = `SELECT rider.id AS rider_id, rider.display_name,
              rider.version, rider.updated_at,
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
       WHERE rider.status='ACTIVE'`;

async function readProjectionRevision(
  db: D1Database,
  cursorScope: string,
): Promise<{ revision: string; rows: EligibleRiderRow[] } | null> {
  const result = await db
    .prepare(
      `${ELIGIBLE_RIDER_SELECT}
       ORDER BY rider.id ASC
       LIMIT ?`,
    )
    .bind(ELIGIBLE_RIDER_PROJECTION_ITEM_LIMIT + 1)
    .all<EligibleRiderRow>();
  if (result.results.length > ELIGIBLE_RIDER_PROJECTION_ITEM_LIMIT) return null;
  return {
    revision: await requestHash({
      kind: "ELIGIBLE_RIDERS",
      scope: cursorScope,
      rows: result.results,
    }),
    rows: result.results,
  };
}

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
  const before = await readProjectionRevision(deps.db, cursorScope);
  if (!before) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Eligible Rider projection exceeds the bounded read limit",
        requestId: request.requestId,
      },
    };
  }
  if (cursor && cursor.revision !== before.revision) {
    return {
      ok: false,
      error: {
        code: "STALE_VERSION",
        message: "Eligible Rider projection changed; refresh is required",
        requestId: request.requestId,
      },
    };
  }
  const cursorClause = cursor ? "AND rider.id>?" : "";
  const bindings: unknown[] = [];
  if (cursor) bindings.push(cursor.id);
  bindings.push(ELIGIBLE_RIDER_PAGE_SIZE + 1);
  const rows = await deps.db
    .prepare(
      `${ELIGIBLE_RIDER_SELECT}
         ${cursorClause}
       ORDER BY rider.id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<EligibleRiderRow>();
  const after = await readProjectionRevision(deps.db, cursorScope);
  if (!after || after.revision !== before.revision) {
    return {
      ok: false,
      error: {
        code: "STALE_VERSION",
        message: "Eligible Rider projection changed; refresh is required",
        requestId: request.requestId,
      },
    };
  }
  const pageRows = rows.results.slice(0, ELIGIBLE_RIDER_PAGE_SIZE);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.results.length > ELIGIBLE_RIDER_PAGE_SIZE && last
      ? encodeEligibleRiderCursor(cursorScope, after.revision, last.rider_id)
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
      projectionRevision: after.revision,
      totalCount: after.rows.length,
    },
    requestId: request.requestId,
  };
}
