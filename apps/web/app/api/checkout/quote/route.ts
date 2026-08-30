import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";
const QUOTE_COMMAND_MAX_BYTES = 16 * 1024;

const bodySchema = z.object({
  cartId: z.string().trim().min(1),
  cartVersion: z.coerce.number().int().positive(),
  addressId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1).optional(),
  promotionCodes: z.array(z.string().trim().min(1).max(64)).max(5).optional(),
});

export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, bodySchema, { maxBytes: QUOTE_COMMAND_MAX_BYTES });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, context.requestId);
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch (error) {
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: (error as Error).message,
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400 },
    );
  }
  return jsonWithRequestId(
    await coreClient(env.CORE).createCheckoutQuote({
      requestId: context.requestId,
      headers: context.coreHeaders,
      cartId: parsed.value.cartId,
      cartVersion: parsed.value.cartVersion,
      addressId: parsed.value.addressId,
      deliveryCycleId: parsed.value.cycleId ?? null,
      promotionCodes: parsed.value.promotionCodes?.map((code) => code.toUpperCase()),
      idempotencyKey,
    }),
    context.requestId,
  );
}
