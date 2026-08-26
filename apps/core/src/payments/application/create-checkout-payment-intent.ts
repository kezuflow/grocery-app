import type { PaymentIntentCommandRequest } from "@freshmarkets/contracts";
import { isSandboxPaymentEnabled, type PaymentRuntimeEnvironment } from "../sandbox-policy";
import { ProviderRegistry } from "../infrastructure/providers/provider-registry";
import { createPayment } from "./create-payment";
import { createCheckoutRepository } from "../../checkout/infrastructure/d1-checkout-repository";

function failure(code: string, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

/**
 * Start a grocery-checkout payment for an ACTIVE quote owned by the
 * requesting customer. Sandbox containment is enforced here (fail-closed
 * outside an explicit nonproduction sandbox environment); production intent
 * creation waits for a configured provider adapter.
 */
export async function createCheckoutPaymentIntent(
  database: D1Database,
  environment: PaymentRuntimeEnvironment,
  command: PaymentIntentCommandRequest & { customerId: string },
): Promise<
  | { ok: true; value: Record<string, unknown>; requestId: string }
  | { ok: false; error: { code: string; message: string; requestId: string } }
> {
  if (!isSandboxPaymentEnabled(environment))
    return failure(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "A payment provider is not configured for this environment.",
      command.requestId,
    );
  const repository = createCheckoutRepository(database);
  const quote = await repository.findQuoteById(command.checkoutAttemptId);
  if (!quote || quote.customerId !== command.customerId || quote.status !== "ACTIVE")
    return failure("CONFLICT", "A valid quote is required to start payment", command.requestId);
  return createPayment(database, new ProviderRegistry(environment.ENVIRONMENT), {
    purpose: "GROCERY_CHECKOUT",
    subjectType: "checkout_quote",
    subjectId: quote.id,
    customerId: command.customerId,
    amountMinor: quote.totalMinor,
    currency: quote.currency,
    providerCode: command.providerCode ?? "",
    returnUrl: command.returnUrl,
    idempotencyKey: command.idempotencyKey,
    requestId: command.requestId,
  });
}
