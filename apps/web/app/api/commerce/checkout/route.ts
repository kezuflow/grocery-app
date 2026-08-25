import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
const checkoutBodySchema = z.object({
  cartId: z.string().trim().min(1),
  addressId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  commit: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function POST(request: Request) {
  const parsed = checkoutBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid checkout request" } },
      { status: 400 },
    );
  const body = parsed.data;
  const input = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cartId: body.cartId,
    addressId: body.addressId,
    cycleId: body.cycleId,
  };
  const core = env.CORE as unknown as CoreServiceBinding;
  return Response.json(
    body.commit
      ? await core.commitMockOrder({
          ...input,
          idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
        })
      : await core.evaluateCheckout(input),
  );
}
