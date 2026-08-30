import {
  deliveryJobStates,
  type AppErrorCode,
  type DeliveryJobState,
  type DeliveryMapPin,
  type DeliveryMapRequest,
  type DeliveryMapView,
  type FulfillmentMode,
  type RpcResult,
} from "@freshmarkets/contracts";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import { decodeDeliveryMapCursor, encodeDeliveryMapCursor } from "./delivery-read-cursor";

const DELIVERY_MAP_PAGE_SIZE = 250;

export type DeliveryMapReadDeps = OperationsAdministrationDeps & { now: () => number };
export type ResolvedDeliveryReadContext = {
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  cycleId: string | null;
};

type DeliveryMapRow = {
  job_id: string;
  order_id: string;
  batch_id: string | null;
  job_sequence: number | null;
  fulfillment_mode: FulfillmentMode;
  cycle_id: string | null;
  location_id: string;
  rider_id: string | null;
  status: DeliveryJobState;
  context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED";
  version: number;
  stop_id: string | null;
  stop_status: DeliveryJobState | null;
  stop_batch_id: string | null;
  stop_sequence: number | null;
  stop_version: number | null;
  latitude: number | null;
  longitude: number | null;
  rider_display_name: string | null;
  batch_fulfillment_mode: FulfillmentMode | null;
  batch_cycle_id: string | null;
  batch_location_id: string | null;
  batch_status: string | null;
  batch_context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED" | null;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deliveryReadRequestId(request: unknown): string {
  return isRecord(request) && nonEmpty(request.requestId) ? request.requestId : "unknown";
}

function hasStringHeaders(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((header) => typeof header === "string");
}

export async function resolveDeliveryReadContext(
  deps: DeliveryMapReadDeps,
  request: DeliveryMapRequest,
): Promise<RpcResult<ResolvedDeliveryReadContext>> {
  const requestId = deliveryReadRequestId(request);
  if (!isRecord(request) || !nonEmpty(request.requestId) || !nonEmpty(request.locationId)) {
    return failure("VALIDATION_FAILED", "Request and location identifiers are required", requestId);
  }
  if (!hasStringHeaders(request.headers)) {
    return failure("VALIDATION_FAILED", "Request headers are invalid", requestId);
  }
  if (
    (request.fulfillmentMode !== "INSTANT" && request.fulfillmentMode !== "SCHEDULED") ||
    (request.fulfillmentMode === "INSTANT" && request.cycleId !== null) ||
    (request.fulfillmentMode === "SCHEDULED" && !nonEmpty(request.cycleId))
  ) {
    return failure(
      "VALIDATION_FAILED",
      "Instant requires no cycle and Scheduled requires a cycle",
      request.requestId,
    );
  }
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.read",
    request.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!access.ok) return access;

  if (request.fulfillmentMode === "SCHEDULED") {
    const cycle = await deps.db
      .prepare(
        `SELECT dc.id
         FROM delivery_cycle dc
         JOIN fulfillment_location location
           ON location.id=? AND location.market_id=dc.market_id AND location.status='active'
         WHERE dc.id=?
           AND EXISTS (
             SELECT 1 FROM cycle_zone_capacity capacity
             WHERE capacity.cycle_id=dc.id AND capacity.location_id=location.id
           )`,
      )
      .bind(request.locationId, request.cycleId)
      .first<{ id: string }>();
    if (!cycle) {
      return failure(
        "NOT_FOUND",
        "Delivery cycle is not available for this location",
        request.requestId,
      );
    }
  }
  return {
    ok: true,
    value: {
      locationId: request.locationId,
      fulfillmentMode: request.fulfillmentMode,
      cycleId: request.cycleId,
    },
    requestId: request.requestId,
  };
}

export function deriveDeliverySelection(
  row: Pick<
    DeliveryMapRow,
    | "status"
    | "context_resolution_status"
    | "batch_id"
    | "job_sequence"
    | "stop_id"
    | "stop_status"
    | "stop_batch_id"
    | "stop_sequence"
    | "stop_version"
    | "batch_fulfillment_mode"
    | "batch_cycle_id"
    | "batch_location_id"
    | "batch_status"
    | "batch_context_resolution_status"
    | "latitude"
    | "longitude"
  >,
  context: ResolvedDeliveryReadContext,
): DeliveryMapPin["selection"] {
  if (row.context_resolution_status !== "RESOLVED")
    return { selectable: false, reason: "JOB_CONTEXT_UNRESOLVED" };
  if (
    row.stop_id === null ||
    row.stop_version === null ||
    row.stop_status !== row.status ||
    row.stop_batch_id !== row.batch_id ||
    row.stop_sequence !== row.job_sequence ||
    (row.batch_id === null) !== (row.job_sequence === null) ||
    (row.stop_batch_id === null) !== (row.stop_sequence === null)
  ) {
    return { selectable: false, reason: "STOP_ASSIGNMENT_INCOHERENT" };
  }
  if (row.batch_id !== null) {
    if (row.batch_context_resolution_status !== "RESOLVED")
      return { selectable: false, reason: "BATCH_CONTEXT_UNRESOLVED" };
    if (
      row.batch_location_id !== context.locationId ||
      row.batch_fulfillment_mode !== context.fulfillmentMode ||
      row.batch_cycle_id !== context.cycleId
    ) {
      return { selectable: false, reason: "BATCH_CONTEXT_MISMATCH" };
    }
  }
  if (row.latitude === null || row.longitude === null)
    return { selectable: false, reason: "MISSING_COORDINATE" };
  if (row.status !== "UNASSIGNED" && row.status !== "RETRY_SCHEDULED")
    return { selectable: false, reason: "STATUS_NOT_ASSIGNABLE" };
  if (row.batch_id !== null && !["COMPLETED", "CANCELED"].includes(row.batch_status ?? ""))
    return { selectable: false, reason: "ACTIVE_BATCH_CONFLICT" };
  return { selectable: true, reason: null };
}

function hasOnlyDeliveryStatuses(statuses: unknown): statuses is readonly DeliveryJobState[] {
  const allowed = new Set<string>(deliveryJobStates);
  return (
    Array.isArray(statuses) &&
    statuses.every((status) => typeof status === "string" && allowed.has(status))
  );
}

export async function getDeliveryMap(
  deps: DeliveryMapReadDeps,
  request: DeliveryMapRequest,
): Promise<RpcResult<DeliveryMapView>> {
  const requestId = deliveryReadRequestId(request);
  if (!isRecord(request)) {
    return failure("VALIDATION_FAILED", "Request must be an object", requestId);
  }
  if (request.statuses !== undefined && !hasOnlyDeliveryStatuses(request.statuses)) {
    return failure("VALIDATION_FAILED", "Unknown delivery status filter", requestId);
  }
  if (request.riderId !== undefined && request.riderId !== null && !nonEmpty(request.riderId)) {
    return failure("VALIDATION_FAILED", "Rider filter must be a non-empty identifier", requestId);
  }
  if (
    request.cursor !== undefined &&
    (!nonEmpty(request.cursor) || request.cursor.length > 1_024)
  ) {
    return failure("VALIDATION_FAILED", "Pagination cursor is invalid", requestId);
  }
  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;

  const cursorScope = JSON.stringify({
    locationId: context.value.locationId,
    fulfillmentMode: context.value.fulfillmentMode,
    cycleId: context.value.cycleId,
    statuses: request.statuses ? [...request.statuses].sort() : null,
    riderId: request.riderId ?? null,
  });
  const cursor = request.cursor ? decodeDeliveryMapCursor(request.cursor, cursorScope) : null;
  if (request.cursor && !cursor) {
    return failure("VALIDATION_FAILED", "Pagination cursor is invalid", requestId);
  }

  const clauses = [
    "job.location_id=?",
    "job.fulfillment_mode=?",
    request.fulfillmentMode === "INSTANT" ? "job.cycle_id IS NULL" : "job.cycle_id=?",
    "job.status NOT IN ('DELIVERED','CANCELED')",
  ];
  const bindings: unknown[] = [request.locationId, request.fulfillmentMode];
  if (request.fulfillmentMode === "SCHEDULED") bindings.push(request.cycleId);
  if (request.statuses && request.statuses.length > 0) {
    clauses.push(`job.status IN (${request.statuses.map(() => "?").join(",")})`);
    bindings.push(...request.statuses);
  }
  if (request.riderId) {
    clauses.push("job.rider_id=?");
    bindings.push(request.riderId);
  }
  if (cursor) {
    clauses.push("job.id>?");
    bindings.push(cursor.id);
  }

  const rows = await deps.db
    .prepare(
      `SELECT job.id AS job_id, job.order_id, job.batch_id, job.sequence AS job_sequence, job.fulfillment_mode,
              job.cycle_id, job.location_id, job.rider_id, job.status,
              job.context_resolution_status, job.version,
              stop.id AS stop_id, stop.status AS stop_status, stop.batch_id AS stop_batch_id,
              stop.sequence AS stop_sequence, stop.version AS stop_version,
              stop.latitude, stop.longitude,
              rider.display_name AS rider_display_name,
              batch.fulfillment_mode AS batch_fulfillment_mode,
              batch.cycle_id AS batch_cycle_id, batch.location_id AS batch_location_id,
              batch.status AS batch_status,
              batch.context_resolution_status AS batch_context_resolution_status
       FROM delivery_job job
       LEFT JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       LEFT JOIN rider_identity rider ON rider.id=job.rider_id
       LEFT JOIN delivery_batch batch ON batch.id=job.batch_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY job.id ASC
       LIMIT ?`,
    )
    .bind(...bindings, DELIVERY_MAP_PAGE_SIZE + 1)
    .all<DeliveryMapRow>();

  const pageRows = rows.results.slice(0, DELIVERY_MAP_PAGE_SIZE);
  const hasMore = rows.results.length > DELIVERY_MAP_PAGE_SIZE;
  const pins: DeliveryMapPin[] = pageRows.map((row) => ({
    jobId: row.job_id,
    orderId: row.order_id,
    batchId: row.batch_id,
    coordinate:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: row.latitude, longitude: row.longitude },
    fulfillmentMode: row.fulfillment_mode,
    cycleId: row.cycle_id,
    status: row.status,
    rider:
      row.rider_id === null || row.rider_display_name === null
        ? null
        : { riderId: row.rider_id, displayName: row.rider_display_name },
    version: row.version,
    selection: deriveDeliverySelection(row, context.value),
  }));
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last ? encodeDeliveryMapCursor(cursorScope, last.job_id) : null;
  return {
    ok: true,
    value: {
      locationId: context.value.locationId,
      fulfillmentMode: context.value.fulfillmentMode,
      cycleId: context.value.cycleId,
      pins,
      nextCursor,
      complete: nextCursor === null,
      generatedAt: new Date(deps.now()).toISOString(),
    },
    requestId: request.requestId,
  };
}
