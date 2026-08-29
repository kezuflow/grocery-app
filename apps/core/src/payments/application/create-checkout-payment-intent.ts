import type { PaymentIntentCommandRequest } from "@freshmarkets/contracts";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { createPayment } from "./create-payment";
import { createCheckoutRepository } from "../../checkout/infrastructure/d1-checkout-repository";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import { revalidateCheckoutQuote } from "../../checkout/application/revalidate-checkout-quote";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Start a grocery-checkout payment for an ACTIVE quote owned by the
 * requesting customer. The composition root supplies the explicitly selected
 * provider registry; no application path chooses by registration order.
 */
export async function createCheckoutPaymentIntent(
  database: D1Database,
  registry: ProviderRegistry,
  providerCode: string,
  routeDistance: RouteDistancePort,
  command: PaymentIntentCommandRequest & { customerId: string },
): Promise<
  | { ok: true; value: Record<string, unknown>; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  const paymentRepository = createPaymentRepository(database);
  const existing = await paymentRepository.findIntentByIdempotencyKey(command.idempotencyKey);
  if (existing) {
    if (
      existing.purpose !== "GROCERY_CHECKOUT" ||
      existing.subjectType !== "checkout_quote" ||
      existing.subjectId !== command.checkoutAttemptId ||
      existing.customerId !== command.customerId ||
      existing.amountMinor !== command.expectedTotalMinor
    )
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different checkout payment",
        command.requestId,
      );
    return createPayment(database, registry, {
      purpose: "GROCERY_CHECKOUT",
      subjectType: "checkout_quote",
      subjectId: command.checkoutAttemptId,
      customerId: command.customerId,
      amountMinor: existing.amountMinor,
      currency: existing.currency,
      providerCode,
      returnUrl: command.returnUrl,
      idempotencyKey: command.idempotencyKey,
      requestId: command.requestId,
    });
  }

  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(command.checkoutAttemptId);
  if (
    !quote ||
    quote.customerId !== command.customerId ||
    quote.status !== "ACTIVE" ||
    quote.expiresAt <= Date.now()
  )
    return failure("CONFLICT", "A valid quote is required to start payment", command.requestId);
  if (command.expectedTotalMinor !== quote.totalMinor)
    return failure(
      "PRICE_CHANGED",
      "Order total changed; review and accept the current total",
      command.requestId,
    );
  const current = await revalidateCheckoutQuote(database, quote, routeDistance);
  if (!current.ok) return failure(current.code, current.message, command.requestId);
  return createPayment(database, registry, {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_quote",
    subjectId: quote.id,
    customerId: command.customerId,
    amountMinor: quote.totalMinor,
    currency: quote.currency,
    providerCode,
    returnUrl: command.returnUrl,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
  });
}
