import { env } from "cloudflare:workers";
import {
  deliveryJobStates,
  type DeliveryMapPin,
  type DeliveryMapView,
  type RpcResult,
} from "@freshmarkets/contracts";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  hasOnlyQueryKeys,
  parseOptionalIdentifier,
  parseOptionalStatuses,
  parseQueryContext,
  validationFailure,
} from "./delivery-map-route-utils";

const QUERY_KEYS = new Set(["locationId", "fulfillmentMode", "cycleId", "statuses", "riderId"]);
const DELIVERY_MAP_MAX_CORE_PAGE_CALLS = 20;
const DELIVERY_MAP_MAX_PAGE_ITEMS = 250;
const DELIVERY_MAP_MAX_ITEMS = 5_000;
const DELIVERY_MAP_ENTRY_WORK_UNITS = 24;
const DELIVERY_MAP_MAX_VALIDATION_WORK_UNITS = 121_000;
const DELIVERY_STATUSES = new Set<string>(deliveryJobStates);

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const params = new URL(request.url).searchParams;
  const context = parseQueryContext(params);
  const statuses = parseOptionalStatuses(params);
  const riderId = parseOptionalIdentifier(params, "riderId");
  if (!hasOnlyQueryKeys(params, QUERY_KEYS) || !context || statuses === null || riderId === null) {
    return validationFailure(requestId, "Invalid delivery map request");
  }

  const core = coreClient(env.CORE);
  const baseRequest = {
    requestId,
    headers: requestHeaders(request),
    ...context,
    ...(statuses === undefined ? {} : { statuses }),
    ...(riderId === undefined ? {} : { riderId }),
  };
  const pins: DeliveryMapPin[] = [];
  const seenCursors = new Set<string>();
  const seenJobIds = new Set<string>();
  let cursor: string | undefined;
  let lastJobId: string | null = null;
  let projectionRevision: string | null = null;
  let totalCount: number | null = null;
  let generatedAt: string | null = null;
  let validationWorkUnits = 0;
  for (let call = 0; call < DELIVERY_MAP_MAX_CORE_PAGE_CALLS; call += 1) {
    const result = await core.getDeliveryMap({ ...baseRequest, ...(cursor ? { cursor } : {}) });
    if (!result.ok) return Response.json(result);
    const page = result.value;
    if (
      !isDeliveryMapPage(page, context) ||
      page.complete !== (page.nextCursor === null) ||
      page.pins.length > DELIVERY_MAP_MAX_PAGE_ITEMS ||
      page.totalCount > DELIVERY_MAP_MAX_ITEMS ||
      (page.nextCursor !== null && seenCursors.has(page.nextCursor)) ||
      (page.nextCursor !== null && page.pins.length === 0)
    ) {
      return Response.json(paginationFailure(requestId));
    }
    validationWorkUnits += page.pins.length * DELIVERY_MAP_ENTRY_WORK_UNITS + 1;
    if (validationWorkUnits > DELIVERY_MAP_MAX_VALIDATION_WORK_UNITS) {
      return Response.json(paginationFailure(requestId));
    }
    projectionRevision ??= page.projectionRevision;
    totalCount ??= page.totalCount;
    generatedAt ??= page.generatedAt;
    if (
      page.projectionRevision !== projectionRevision ||
      page.totalCount !== totalCount ||
      page.generatedAt !== generatedAt ||
      pins.length + page.pins.length > totalCount ||
      pins.length + page.pins.length > DELIVERY_MAP_MAX_ITEMS
    ) {
      return Response.json(paginationFailure(requestId));
    }
    for (const pin of page.pins) {
      if (
        seenJobIds.has(pin.jobId) ||
        (lastJobId !== null && compareIdentifiers(pin.jobId, lastJobId) <= 0)
      ) {
        return Response.json(paginationFailure(requestId));
      }
      seenJobIds.add(pin.jobId);
      lastJobId = pin.jobId;
    }
    pins.push(...page.pins);
    if (page.nextCursor === null) {
      if (pins.length !== totalCount) return Response.json(paginationFailure(requestId));
      const value: DeliveryMapView = {
        ...context,
        pins,
        nextCursor: null,
        complete: true,
        projectionRevision,
        totalCount,
        generatedAt,
      };
      return Response.json({ ok: true, value, requestId } satisfies RpcResult<DeliveryMapView>);
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return Response.json(paginationFailure(requestId));
}

function isDeliveryMapPage(
  value: unknown,
  context: { locationId: string; fulfillmentMode: "INSTANT" | "SCHEDULED"; cycleId: string | null },
): value is DeliveryMapView {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "locationId",
      "fulfillmentMode",
      "cycleId",
      "pins",
      "nextCursor",
      "complete",
      "projectionRevision",
      "totalCount",
      "generatedAt",
    ])
  )
    return false;
  const page = value as Partial<DeliveryMapView>;
  return (
    page.locationId === context.locationId &&
    page.fulfillmentMode === context.fulfillmentMode &&
    page.cycleId === context.cycleId &&
    Array.isArray(page.pins) &&
    page.pins.every((pin) => isDeliveryMapPin(pin, context)) &&
    typeof page.complete === "boolean" &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === "string" &&
        page.nextCursor.length > 0 &&
        page.nextCursor.length <= 1_024 &&
        /^[A-Za-z0-9_-]+$/.test(page.nextCursor))) &&
    typeof page.projectionRevision === "string" &&
    /^[a-f0-9]{64}$/.test(page.projectionRevision) &&
    isNonNegativeInteger(page.totalCount) &&
    typeof page.generatedAt === "string" &&
    isCanonicalInstant(page.generatedAt)
  );
}

function isDeliveryMapPin(
  value: unknown,
  context: { locationId: string; fulfillmentMode: "INSTANT" | "SCHEDULED"; cycleId: string | null },
): value is DeliveryMapPin {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "jobId",
      "orderId",
      "batchId",
      "coordinate",
      "fulfillmentMode",
      "cycleId",
      "status",
      "rider",
      "version",
      "selection",
    ])
  )
    return false;
  return (
    isIdentifier(value.jobId) &&
    isIdentifier(value.orderId) &&
    (value.batchId === null || isIdentifier(value.batchId)) &&
    isCoordinate(value.coordinate) &&
    value.fulfillmentMode === context.fulfillmentMode &&
    value.cycleId === context.cycleId &&
    typeof value.status === "string" &&
    DELIVERY_STATUSES.has(value.status) &&
    (value.rider === null || isRiderIdentity(value.rider)) &&
    isPositiveInteger(value.version) &&
    isSelection(value.selection)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isCoordinate(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactKeys(value, ["latitude", "longitude"])) return false;
  return (
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function isRiderIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["riderId", "displayName"]) &&
    isIdentifier(value.riderId) &&
    isDisplayName(value.displayName)
  );
}

function isDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
  );
}

function isSelection(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["selectable", "reason"]) ||
    typeof value.selectable !== "boolean"
  )
    return false;
  return value.selectable
    ? value.reason === null
    : typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 200;
}

function isCanonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function paginationFailure(requestId: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Delivery map pagination could not be completed safely",
      requestId,
    },
  };
}
