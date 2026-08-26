import { env } from "cloudflare:workers";
import { DEFAULT_MARKET_CODE } from "@freshmarkets/config";
import { coreClient } from "@/lib/core-client/core";
export async function GET() {
  return Response.json(
    await coreClient(env.CORE).listDeliveryCycles({
      requestId: crypto.randomUUID(),
      marketCode: DEFAULT_MARKET_CODE,
    }),
  );
}
