import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { requestHeaders } from "../../../../lib/core-client/request";
import { isWebSandboxPaymentEnabled } from "../../../../lib/payments/runtime-policy";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { coreClient } from "@/lib/core-client/core";
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
  const core = coreClient(env.CORE);
  if (body.commit) {
    let idempotencyKey: string;
    try {
      idempotencyKey = requireIdempotencyKey(request, body.idempotencyKey);
    } catch (error) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
        { status: 400 },
      );
    }
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
    return Response.json(await core.commitMockOrder({ ...input, idempotencyKey }));
  }
  return Response.json(await core.evaluateCheckout(input));
}
