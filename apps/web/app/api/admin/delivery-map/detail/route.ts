import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  hasOnlyQueryKeys,
  parsePositiveVersion,
  parseQueryContext,
  parseRequiredIdentifier,
  validationFailure,
} from "../delivery-map-route-utils";

const QUERY_KEYS = new Set([
  "locationId",
  "fulfillmentMode",
  "cycleId",
  "jobId",
  "expectedVersion",
]);

async function GETHandler(request: Request) {
  const requestId = webRequestId(request);
  const params = new URL(request.url).searchParams;
  const context = parseQueryContext(params);
  const jobId = parseRequiredIdentifier(params, "jobId");
  const expectedVersion = parsePositiveVersion(params, "expectedVersion");
  if (!hasOnlyQueryKeys(params, QUERY_KEYS) || !context || !jobId || expectedVersion === null) {
    return validationFailure(requestId, "Invalid delivery map detail request");
  }

  return adminJson(
    await coreClient(env.CORE).getDeliveryMapDetail({
      requestId,
      headers: requestHeaders(request),
      ...context,
      jobId,
      expectedVersion,
    }),
  );
}

export const GET = observeAdminRoute("admin.delivery_map.detail.get", GETHandler);
