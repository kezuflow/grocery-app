import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for the Core-owned payment overview. */
async function GETHandler(request: Request) {
  const result = await coreClient(env.CORE).getAdminPaymentOverview({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.payments.overview.get", GETHandler);
