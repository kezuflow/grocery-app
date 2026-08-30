import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const requestContext = webRequestContext(request);
  const { "order-id": orderId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).getCustomerOrderDetail({
      requestId: requestContext.requestId,
      headers: requestContext.coreHeaders,
      orderId,
    }),
    requestContext.requestId,
  );
}
