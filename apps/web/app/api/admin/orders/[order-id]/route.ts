import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one order detail. */
async function GETHandler(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const { "order-id": orderId } = await context.params;
  const result = await coreClient(env.CORE).getAdminOrder({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    orderId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.orders.by_order_id.get", GETHandler);
