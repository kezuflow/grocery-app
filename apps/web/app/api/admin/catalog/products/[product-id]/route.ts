import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one product detail. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
  const result = await coreClient(env.CORE).getAdminProduct({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    productId,
  });
  return Response.json(result);
}
