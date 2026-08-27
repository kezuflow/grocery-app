import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
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
  if (body.commit)
    return Response.json(
      {
        ok: false,
        error: {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message:
            "Mock commitment was removed; use /api/checkout/quote and /api/checkout/payment.",
        },
      },
      { status: 410 },
    );
  const input = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    cartId: body.cartId,
    addressId: body.addressId,
    cycleId: body.cycleId,
  };
  const core = coreClient(env.CORE);
  return Response.json(await core.evaluateCheckout(input));
}
