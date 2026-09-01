import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Purpose-built admin operations board. Authorization, section filtering,
 * and allowed-action derivation happen in Core IAM; this route is transport
 * only.
 */
async function GETHandler(request: Request) {
  const locationId = new URL(request.url).searchParams.get("locationId");
  const result = await coreClient(env.CORE).adminOperationsBoard({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    locationId: locationId && locationId.trim() !== "" ? locationId : null,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.operations.get", GETHandler);
