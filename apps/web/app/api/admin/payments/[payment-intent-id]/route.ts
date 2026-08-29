import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one Core-owned payment intent workspace. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "payment-intent-id": string }> },
) {
  const { "payment-intent-id": paymentIntentId } = await context.params;
  const result = await coreClient(env.CORE).getAdminPayment({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    paymentIntentId,
  });
  return Response.json(result);
}
