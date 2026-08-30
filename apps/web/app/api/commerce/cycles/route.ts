import { env } from "cloudflare:workers";
import { DEFAULT_MARKET_CODE } from "@freshmarkets/config";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";
export async function GET(request: Request) {
  const context = webRequestContext(request);
  return jsonWithRequestId(
    await coreClient(env.CORE).listDeliveryCycles({
      requestId: context.requestId,
      marketCode: DEFAULT_MARKET_CODE,
    }),
    context.requestId,
  );
}
