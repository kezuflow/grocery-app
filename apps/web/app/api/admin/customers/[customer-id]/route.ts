import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one composed customer detail. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "customer-id": string }> },
) {
  const { "customer-id": customerId } = await context.params;
  const result = await coreClient(env.CORE).getAdminCustomer({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    customerId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.customers.by_customer_id.get", GETHandler);
