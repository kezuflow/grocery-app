import { env } from "cloudflare:workers";
import type { DeliveryMapPin, DeliveryMapView, RpcResult } from "@freshmarkets/contracts";
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
  let cursor: string | undefined;
  let generatedAt: string | null = null;
  for (;;) {
    const result = await core.getDeliveryMap({ ...baseRequest, ...(cursor ? { cursor } : {}) });
    if (!result.ok) return Response.json(result);
    const page = result.value;
    if (
      !isDeliveryMapPage(page, context) ||
      page.complete !== (page.nextCursor === null) ||
      (page.nextCursor !== null && seenCursors.has(page.nextCursor)) ||
      (page.nextCursor !== null && page.pins.length === 0)
    ) {
      return Response.json(paginationFailure(requestId));
    }
    pins.push(...page.pins);
    generatedAt ??= page.generatedAt;
    if (page.nextCursor === null) {
      const value: DeliveryMapView = {
        ...context,
        pins,
        nextCursor: null,
        complete: true,
        generatedAt,
      };
      return Response.json({ ok: true, value, requestId } satisfies RpcResult<DeliveryMapView>);
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function isDeliveryMapPage(
  value: unknown,
  context: { locationId: string; fulfillmentMode: "INSTANT" | "SCHEDULED"; cycleId: string | null },
): value is DeliveryMapView {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Partial<DeliveryMapView>;
  return (
    page.locationId === context.locationId &&
    page.fulfillmentMode === context.fulfillmentMode &&
    page.cycleId === context.cycleId &&
    Array.isArray(page.pins) &&
    typeof page.complete === "boolean" &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === "string" &&
        page.nextCursor.length > 0 &&
        page.nextCursor.length <= 1_024)) &&
    typeof page.generatedAt === "string" &&
    page.generatedAt.length > 0
  );
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
