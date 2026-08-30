import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";
const CHECKOUT_COMMAND_MAX_BYTES = 16 * 1024;
const checkoutBodySchema = z.object({
  cartId: z.string().trim().min(1),
  addressId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  commit: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
});
export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, checkoutBodySchema, {
    maxBytes: CHECKOUT_COMMAND_MAX_BYTES,
  });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  const body = parsed.value;
  if (body.commit)
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message:
            "Mock commitment was removed; use /api/checkout/quote and /api/checkout/payment.",
        },
      },
      context.requestId,
      { status: 410 },
    );
  const input = {
    requestId: context.requestId,
    headers: context.coreHeaders,
    cartId: body.cartId,
    addressId: body.addressId,
    cycleId: body.cycleId,
  };
  const core = coreClient(env.CORE);
  return jsonWithRequestId(await core.evaluateCheckout(input), context.requestId);
}
