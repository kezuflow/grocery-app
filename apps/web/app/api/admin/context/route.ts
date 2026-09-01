import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * Thin same-origin BFF adapter for the admin context. Authorization and
 * navigation derivation happen in Core IAM; this route is transport only.
 */
async function GETHandler(request: Request) {
  const result = await coreClient(env.CORE).getAdminContext({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.context.get", GETHandler);
