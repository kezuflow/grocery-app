import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../../lib/core-client/request";
export async function GET(request: Request) {
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).getCart({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}
export async function POST(request: Request) {
  const body = (await request.json()) as { skuId: string; quantity: number };
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).setCartItem({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      skuId: body.skuId,
      quantity: body.quantity,
    }),
  );
}
