import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one Core-owned payment intent workspace. */
async function GETHandler(
  request: Request,
  context: { params: Promise<{ "payment-intent-id": string }> },
) {
  const { "payment-intent-id": paymentIntentId } = await context.params;
  const result = await coreClient(env.CORE).getAdminPayment({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    paymentIntentId,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.payments.by_payment_intent_id.get", GETHandler);
