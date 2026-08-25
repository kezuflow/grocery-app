import { env } from "cloudflare:workers";
import { DEFAULT_MARKET_CODE } from "@freshmarkets/config";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
export async function GET() {
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).listDeliveryCycles({
      requestId: crypto.randomUUID(),
      marketCode: DEFAULT_MARKET_CODE,
    }),
  );
}
