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
const PAYMENT_COMMAND_MAX_BYTES = 16 * 1024;

const bodySchema = z.object({
  checkoutAttemptId: z.string().trim().min(1),
  expectedTotalMinor: z.number().int().nonnegative(),
  returnUrl: z.string().url(),
});

export async function POST(request: Request) {
  const context = webRequestContext(request);
  const parsed = await readBoundedJson(request, bodySchema, {
    maxBytes: PAYMENT_COMMAND_MAX_BYTES,
  });
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
  // The browser never asserts success: the response is a pending action at
  // most, and order commitment originates solely from Core's Payments reaction.
  return jsonWithRequestId(
    await coreClient(env.CORE).createPaymentIntent({
      requestId: context.requestId,
      headers: context.coreHeaders,
      checkoutAttemptId: parsed.value.checkoutAttemptId,
      expectedTotalMinor: parsed.value.expectedTotalMinor,
      returnUrl: parsed.value.returnUrl,
      idempotencyKey,
    }),
    context.requestId,
  );
}

export async function GET(request: Request) {
  const context = webRequestContext(request);
  return jsonWithRequestId(
    {
      ok: true,
      value: { providerConfigured: false },
      requestId: context.requestId,
    },
    context.requestId,
  );
}
