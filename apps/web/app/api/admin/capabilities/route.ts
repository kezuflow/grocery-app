import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** The closed canonical capability vocabulary. Transport only. */
async function GETHandler(request: Request) {
  const result = await coreClient(env.CORE).listCapabilityDefinitions({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.capabilities.get", GETHandler);
