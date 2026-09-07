import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request, context: { params: Promise<{ "sku-id": string }> }) {
  const { "sku-id": skuId } = await context.params;
  const trace = webRequestContext(request);
  const result = await coreClient(env.CORE).getAdminSkuPrices({
    requestId: trace.requestId,
    headers: trace.coreHeaders,
    skuId,
    locationId: new URL(request.url).searchParams.get("locationId") ?? "",
  });
  return jsonWithRequestId(result, trace.requestId);
}
