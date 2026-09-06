import type {
  PaymentActionView,
  PaymentIntentCommandRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import type { AppErrorCode } from "@freshmarkets/contracts";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import { createPayment } from "./create-payment";
import { createCheckoutRepository } from "../../checkout/infrastructure/d1-checkout-repository";
import type { RouteDistancePort } from "../../geography/ports/route-distance";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import { revalidateCheckoutQuote } from "../../checkout/application/revalidate-checkout-quote";
import { requireSellingOpen } from "../../commerce/application/global-commerce-configuration";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function acceptedPriceMatches(
  command: PaymentIntentCommandRequest,
  quote: Awaited<ReturnType<ReturnType<typeof createCheckoutRepository>["findQuoteById"]>> & {},
  allowCommittedReplay = false,
): boolean {
  return (
    (command.expectedQuoteVersion === quote.version ||
      (allowCommittedReplay &&
        quote.status === "CONSUMED" &&
        command.expectedQuoteVersion + 1 === quote.version)) &&
    command.expectedPriceAcceptanceVersion === quote.priceAcceptanceVersion &&
    command.expectedCurrency === quote.currency &&
    command.expectedMerchandiseSubtotalMinor === quote.financial.merchandiseSubtotalMinor &&
    command.expectedItemDiscountMinor === quote.financial.itemDiscountMinor &&
    command.expectedOrderDiscountMinor === quote.financial.orderDiscountMinor &&
    command.expectedDeliverySubtotalMinor === quote.financial.deliverySubtotalMinor &&
    command.expectedDeliveryFeeMinor === quote.deliveryFeeMinor &&
    command.expectedDeliveryDiscountMinor === quote.financial.deliveryDiscountMinor &&
    command.expectedTaxMinor === quote.financial.taxMinor &&
    command.expectedTotalMinor === quote.financial.totalMinor
  );
}

/**
 * Start a grocery-checkout payment for an ACTIVE quote owned by the
 * requesting customer. The composition root supplies the explicitly selected
 * provider registry; no application path chooses by registration order.
 */
export async function createCheckoutPaymentIntent(
  database: D1Database,
  registry: PaymentProviderRegistry,
  providerCode: string,
  routeDistance: RouteDistancePort,
  command: PaymentIntentCommandRequest & { customerId: string },
  deliveryProviders?: ReadonlyMap<string, DeliveryProvider>,
): Promise<RpcResult<PaymentActionView>> {
  const paymentRepository = createPaymentRepository(database);
  const existing = await paymentRepository.findIntentByIdempotencyKey(command.idempotencyKey);
  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(command.checkoutAttemptId);
  if (existing) {
    if (
      existing.purpose !== "GROCERY_CHECKOUT" ||
      existing.subjectType !== "checkout_quote" ||
      existing.subjectId !== command.checkoutAttemptId ||
      existing.customerId !== command.customerId ||
      existing.amountMinor !== command.expectedTotalMinor ||
      existing.currency !== command.expectedCurrency ||
      !quote ||
      !acceptedPriceMatches(command, quote, true)
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

  const selling = await requireSellingOpen(database, command.requestId);
  if (!selling.ok) return selling;

  if (
    !quote ||
    quote.customerId !== command.customerId ||
    quote.status !== "ACTIVE" ||
    quote.expiresAt <= Date.now()
  )
    return failure("CONFLICT", "A valid quote is required to start payment", command.requestId);
  if (!acceptedPriceMatches(command, quote))
    return failure(
      "PRICE_CHANGED",
      "Order total changed; review and accept the current total",
      command.requestId,
    );
  const current = await revalidateCheckoutQuote(
    database,
    quote,
    routeDistance,
    Date.now(),
    deliveryProviders,
  );
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
