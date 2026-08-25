import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { isWebSandboxPaymentEnabled } from "../../../../lib/payments/runtime-policy";
const checkoutBodySchema = z.object({
  cartId: z.string().trim().min(1),
  addressId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  commit: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function GET(_request?: Request) {
  return Response.json({
    ok: true,
    value: { sandboxPaymentEnabled: isWebSandboxPaymentEnabled(env) },
  });
}
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
  if (body.commit) {
    if (!isWebSandboxPaymentEnabled(env))
      return Response.json(
        {
          ok: false,
          error: {
            code: "PAYMENT_PROVIDER_UNAVAILABLE",
            message: "A payment provider is not configured for this environment.",
          },
        },
        { status: 503 },
      );
    if (!body.idempotencyKey)
      return Response.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "A stable idempotency key from the client attempt is required",
          },
        },
        { status: 400 },
      );
    return Response.json(
      await core.commitMockOrder({ ...input, idempotencyKey: body.idempotencyKey }),
    );
  }
  return Response.json(await core.evaluateCheckout(input));
}
