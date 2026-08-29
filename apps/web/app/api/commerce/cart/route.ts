import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
const cartBodySchema = z.object({
  cartId: z.string().trim().min(1),
  skuId: z.string().trim().min(1),
  quantity: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8),
});
export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).getCart({
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
    await coreClient(env.CORE).setCartItem({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      cartId: body.cartId,
      skuId: body.skuId,
      quantity: body.quantity,
      expectedVersion: body.expectedVersion,
      idempotencyKey: body.idempotencyKey,
    }),
  );
}
