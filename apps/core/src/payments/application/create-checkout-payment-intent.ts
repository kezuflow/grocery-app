import type { PaymentIntentCommandRequest } from "@freshmarkets/contracts";
import type { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { createPayment } from "./create-payment";
import { createCheckoutRepository } from "../../checkout/infrastructure/d1-checkout-repository";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import type { RouteDistancePort } from "../../geography/ports/route-distance";

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
  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(command.checkoutAttemptId);
  if (!quote || quote.customerId !== command.customerId || quote.status !== "ACTIVE")
    return failure("CONFLICT", "A valid quote is required to start payment", command.requestId);
  if (command.expectedTotalMinor !== quote.totalMinor)
    return failure(
      "PRICE_CHANGED",
      "Order total changed; review and accept the current total",
      command.requestId,
    );
  const cart = await database
    .prepare("SELECT version FROM cart WHERE id=? AND customer_id=? AND status='ACTIVE'")
    .bind(quote.cartId, command.customerId)
    .first<{ version: number }>();
  if (!cart)
    return failure("CONFLICT", "A valid cart is required to start payment", command.requestId);
  const current = await createCheckoutQuote(
    database,
    {
      customerId: command.customerId,
      cartId: quote.cartId,
      cartVersion: cart.version,
      addressId: quote.addressId,
      deliveryCycleId: quote.deliveryCycleId,
      idempotencyKey: `payment-validation:${command.idempotencyKey}`,
      requestId: command.requestId,
    },
    { routeDistance },
  );
  if (!current.ok) return current;
  if (current.value.totalMinor !== command.expectedTotalMinor)
    return failure(
      "PRICE_CHANGED",
      "Order total changed; review and accept the current total",
      command.requestId,
    );
  return createPayment(database, registry, {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_quote",
    subjectId: current.value.quoteId,
    customerId: command.customerId,
    amountMinor: current.value.totalMinor,
    currency: current.value.currency,
    providerCode,
    returnUrl: command.returnUrl,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
  });
}
