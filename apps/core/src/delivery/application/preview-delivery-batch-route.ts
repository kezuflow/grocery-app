import type {
  AppErrorCode,
  BatchRoutePreview,
  FulfillmentMode,
  PreviewDeliveryBatchRouteRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  RoutePreviewError,
  type RoutePreviewErrorCode,
  type RoutePreviewPort,
  type RoutePreviewResult,
} from "../../geography/ports/route-preview";
import {
  deriveDeliverySelection,
  deliveryReadRequestId,
  resolveDeliveryReadContext,
  type DeliveryMapReadDeps,
} from "./get-delivery-map";

export type PreviewDeliveryBatchRouteDeps = DeliveryMapReadDeps & {
  routePreview: RoutePreviewPort;
};

type PreviewRow = {
  job_id: string;
  batch_id: string | null;
  job_sequence: number | null;
  fulfillment_mode: FulfillmentMode;
  cycle_id: string | null;
  location_id: string;
  context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED";
  version: number;
  status: import("@freshmarkets/contracts").DeliveryJobState;
  stop_id: string | null;
  stop_status: import("@freshmarkets/contracts").DeliveryJobState | null;
  stop_batch_id: string | null;
  stop_sequence: number | null;
  stop_version: number | null;
  latitude: number | null;
  longitude: number | null;
  batch_status: string | null;
  batch_fulfillment_mode: FulfillmentMode | null;
  batch_cycle_id: string | null;
  batch_location_id: string | null;
  batch_context_resolution_status: "RESOLVED" | "LEGACY_UNRESOLVED" | null;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function coordinateFromValues(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  ) {
    return { latitude, longitude };
  }
  return null;
}

function isValidRequest(request: unknown): request is PreviewDeliveryBatchRouteRequest {
  if (!isRecord(request) || !Array.isArray(request.orderedDeliveries)) return false;
  if (request.orderedDeliveries.length < 1 || request.orderedDeliveries.length > 24) return false;
  const jobIds = new Set<string>();
  for (const item of request.orderedDeliveries) {
    if (
      !isRecord(item) ||
      !nonEmpty(item.jobId) ||
      !Number.isInteger(item.expectedVersion) ||
      (item.expectedVersion as number) <= 0 ||
      jobIds.has(item.jobId)
    ) {
      return false;
    }
    jobIds.add(item.jobId);
  }
  return true;
}

function warning(code: NonNullable<BatchRoutePreview["warning"]>["code"]): BatchRoutePreview {
  const messages: Record<NonNullable<BatchRoutePreview["warning"]>["code"], string> = {
    ROUTE_NOT_FOUND: "No driving route is available for this manual order",
    ROUTE_TIMEOUT: "Route preview timed out; assignment remains available",
    ROUTE_UNAVAILABLE: "Route preview is temporarily unavailable; assignment remains available",
    ROUTE_INVALID_RESPONSE:
      "Route preview returned an unusable result; assignment remains available",
  };
  return {
    outcome: "WARNING",
    geometry: null,
    totalMeters: null,
    totalSeconds: null,
    legs: [],
    warning: { code, message: messages[code] },
  };
}

function providerWarningCode(
  code: RoutePreviewErrorCode,
): NonNullable<BatchRoutePreview["warning"]>["code"] {
  switch (code) {
    case "ROUTE_NOT_FOUND":
      return "ROUTE_NOT_FOUND";
    case "ROUTE_TIMEOUT":
      return "ROUTE_TIMEOUT";
    case "ROUTE_INVALID_RESPONSE":
    case "ROUTE_INVALID_REQUEST":
      return "ROUTE_INVALID_RESPONSE";
    case "ROUTE_UNCONFIGURED":
    case "ROUTE_UNAVAILABLE":
      return "ROUTE_UNAVAILABLE";
  }
}

function available(
  route: RoutePreviewResult,
  orderedDeliveries: PreviewDeliveryBatchRouteRequest["orderedDeliveries"],
): BatchRoutePreview {
  return {
    outcome: "AVAILABLE",
    geometry: route.geometry,
    totalMeters: route.totalMeters,
    totalSeconds: route.totalSeconds,
    legs: route.legs.map((leg, index) => ({
      jobId: orderedDeliveries[index].jobId,
      meters: leg.meters,
      seconds: leg.seconds,
    })),
    warning: null,
  };
}

export async function previewDeliveryBatchRoute(
  deps: PreviewDeliveryBatchRouteDeps,
  request: PreviewDeliveryBatchRouteRequest,
): Promise<RpcResult<BatchRoutePreview>> {
  const requestId = deliveryReadRequestId(request);
  if (!isValidRequest(request))
    return failure(
      "VALIDATION_FAILED",
      "One to 24 unique delivery versions are required",
      requestId,
    );

  const context = await resolveDeliveryReadContext(deps, request);
  if (!context.ok) return context;

  const origin = await deps.db
    .prepare("SELECT latitude, longitude FROM fulfillment_location WHERE id=? AND status='active'")
    .bind(context.value.locationId)
    .first<{ latitude: number | null; longitude: number | null }>();
  const originCoordinate = origin ? coordinateFromValues(origin.latitude, origin.longitude) : null;
  if (!originCoordinate)
    return failure(
      "VALIDATION_FAILED",
      "Fulfillment location coordinates are unavailable",
      request.requestId,
    );

  const ids = request.orderedDeliveries.map(({ jobId }) => jobId);
  const rows = await deps.db
    .prepare(
      `SELECT job.id AS job_id, job.batch_id, job.sequence AS job_sequence,
              job.fulfillment_mode, job.cycle_id, job.location_id,
              job.context_resolution_status, job.version, job.status,
              stop.id AS stop_id, stop.status AS stop_status, stop.batch_id AS stop_batch_id,
              stop.sequence AS stop_sequence, stop.version AS stop_version,
              stop.latitude, stop.longitude,
              batch.status AS batch_status,
              batch.fulfillment_mode AS batch_fulfillment_mode,
              batch.cycle_id AS batch_cycle_id, batch.location_id AS batch_location_id,
              batch.context_resolution_status AS batch_context_resolution_status
       FROM delivery_job job
       LEFT JOIN delivery_stop stop ON stop.delivery_job_id=job.id
       LEFT JOIN delivery_batch batch ON batch.id=job.batch_id
       WHERE job.id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<PreviewRow>();
  const rowsById = new Map(rows.results.map((row) => [row.job_id, row]));
  const orderedDestinations: Array<{ latitude: number; longitude: number }> = [];
  for (const delivery of request.orderedDeliveries) {
    const row = rowsById.get(delivery.jobId);
    if (
      !row ||
      row.location_id !== context.value.locationId ||
      row.fulfillment_mode !== context.value.fulfillmentMode ||
      row.cycle_id !== context.value.cycleId
    ) {
      return failure("NOT_FOUND", "Delivery job is unavailable in this context", request.requestId);
    }
    if (row.version !== delivery.expectedVersion)
      return failure(
        "STALE_VERSION",
        "Delivery job changed; refresh before previewing",
        request.requestId,
      );
    const selection = deriveDeliverySelection(row, context.value);
    if (!selection.selectable) {
      return failure(
        selection.reason === "MISSING_COORDINATE" ? "VALIDATION_FAILED" : "CONFLICT",
        "Delivery job is not selectable for route preview",
        request.requestId,
      );
    }
    const destinationCoordinate = coordinateFromValues(row.latitude, row.longitude);
    if (!destinationCoordinate)
      return failure(
        "VALIDATION_FAILED",
        "Delivery coordinates are unavailable",
        request.requestId,
      );
    orderedDestinations.push(destinationCoordinate);
  }

  try {
    const route = await deps.routePreview.preview({
      origin: originCoordinate,
      orderedDestinations,
    });
    if (route.legs.length !== request.orderedDeliveries.length)
      return { ok: true, value: warning("ROUTE_INVALID_RESPONSE"), requestId: request.requestId };
    return {
      ok: true,
      value: available(route, request.orderedDeliveries),
      requestId: request.requestId,
    };
  } catch (error) {
    const code =
      error instanceof RoutePreviewError
        ? providerWarningCode(error.code)
        : ("ROUTE_UNAVAILABLE" as const);
    return { ok: true, value: warning(code), requestId: request.requestId };
  }
}
