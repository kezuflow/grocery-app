import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one membership. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "subscription-id": string }> },
) {
  const { "subscription-id": subscriptionId } = await context.params;
  const result = await coreClient(env.CORE).getAdminMembership({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    subscriptionId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.memberships.by_subscription_id.get", GETHandler);
