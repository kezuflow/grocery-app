import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
const cartBodySchema = z.object({
  skuId: z.string().trim().min(1),
  quantity: z.number().int().nonnegative(),
});
export async function GET(request: Request) {
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).getCart({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}
export async function POST(request: Request) {
  const parsed = cartBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid cart request" } },
      { status: 400 },
    );
  const body = parsed.data;
  return Response.json(
    await (env.CORE as unknown as CoreServiceBinding).setCartItem({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      skuId: body.skuId,
      quantity: body.quantity,
    }),
  );
}
