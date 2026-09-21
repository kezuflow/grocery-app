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
  expectedQuoteVersion: z.number().int().positive(),
  expectedPriceAcceptanceVersion: z.number().int().positive(),
  expectedCurrency: z.string().trim().length(3),
  expectedMerchandiseSubtotalMinor: z.number().int().nonnegative(),
  expectedItemDiscountMinor: z.number().int().nonnegative(),
  expectedOrderDiscountMinor: z.number().int().nonnegative(),
  expectedDeliverySubtotalMinor: z.number().int().nonnegative(),
  expectedDeliveryFeeMinor: z.number().int().nonnegative(),
  expectedDeliveryDiscountMinor: z.number().int().nonnegative(),
  expectedTaxMinor: z.number().int().nonnegative(),
  expectedTotalMinor: z.number().int().nonnegative(),
  paymentMethod: z.object({ kind: z.literal("TOKEN"), value: z.literal("qrph") }),
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
  try {
    // The browser never asserts success: the response is a pending action at
    // most, and order commitment originates solely from Core's Payments reaction.
    return jsonWithRequestId(
      await coreClient(env.CORE).createPaymentIntent({
        requestId: context.requestId,
        headers: context.coreHeaders,
        checkoutAttemptId: parsed.value.checkoutAttemptId,
        expectedQuoteVersion: parsed.value.expectedQuoteVersion,
        expectedPriceAcceptanceVersion: parsed.value.expectedPriceAcceptanceVersion,
        expectedCurrency: parsed.value.expectedCurrency.toUpperCase(),
        expectedMerchandiseSubtotalMinor: parsed.value.expectedMerchandiseSubtotalMinor,
        expectedItemDiscountMinor: parsed.value.expectedItemDiscountMinor,
        expectedOrderDiscountMinor: parsed.value.expectedOrderDiscountMinor,
        expectedDeliverySubtotalMinor: parsed.value.expectedDeliverySubtotalMinor,
        expectedDeliveryFeeMinor: parsed.value.expectedDeliveryFeeMinor,
        expectedDeliveryDiscountMinor: parsed.value.expectedDeliveryDiscountMinor,
        expectedTaxMinor: parsed.value.expectedTaxMinor,
        expectedTotalMinor: parsed.value.expectedTotalMinor,
        paymentMethod: parsed.value.paymentMethod,
        returnUrl: parsed.value.returnUrl,
        idempotencyKey,
      }),
      context.requestId,
    );
  } catch {
    // A command transport failure cannot prove whether Core/provider adoption
    // happened. Return a controlled unknown outcome so an exact-key replay can
    // recover without creating another payment identity.
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "PAYMENT_OUTCOME_UNRESOLVED",
          message: "Payment setup could not be confirmed. Retry the same checkout payment.",
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  const context = webRequestContext(request);
  const runtimeEnv = env as typeof env & {
    ENVIRONMENT?: string;
    PAYMONGO_PUBLIC_KEY?: string;
  };
  const candidate = runtimeEnv.PAYMONGO_PUBLIC_KEY?.trim() || null;
  const environment = String(runtimeEnv.ENVIRONMENT ?? "development");
  const requiredPrefix = environment === "production" ? "pk_live_" : "pk_test_";
  const publicKey = candidate?.startsWith(requiredPrefix) ? candidate : null;
  return jsonWithRequestId(
    {
      ok: true,
      value: {
        providerConfigured: publicKey !== null,
        providerCode: publicKey ? "paymongo" : null,
        publicKey,
      },
      requestId: context.requestId,
    },
    context.requestId,
  );
}
