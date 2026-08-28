import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one order detail. */
export async function GET(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const { "order-id": orderId } = await context.params;
  const result = await coreClient(env.CORE).getAdminOrder({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    orderId,
  });
  return Response.json(result);
}
