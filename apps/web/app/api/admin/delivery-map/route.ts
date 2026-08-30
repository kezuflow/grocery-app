import { env } from "cloudflare:workers";
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

  return Response.json(
    await coreClient(env.CORE).getDeliveryMap({
      requestId,
      headers: requestHeaders(request),
      ...context,
      ...(statuses === undefined ? {} : { statuses }),
      ...(riderId === undefined ? {} : { riderId }),
    }),
  );
}
