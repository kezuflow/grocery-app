import type { AppErrorCode, SubscriptionSummary } from "@freshmarkets/contracts";
import { createPaymentRepository } from "../infrastructure/d1/payment-repository";
import type { PaymentProviderRegistry } from "../ports/provider-registry";
import type { ProviderSubscriptionView } from "../ports/payment-provider";

type ProvisionCommand = {
  providerCode: string;
  subscription: SubscriptionSummary;
  customerId: string;
  offerName: string;
  priceVersionId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  requestId: string;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export async function provisionPaidMembership(
  database: D1Database,
  registry: PaymentProviderRegistry,
  command: ProvisionCommand,
): Promise<
  { ok: true; value: SubscriptionSummary; requestId: string } | ReturnType<typeof failure>
> {
  const provider = registry.get(command.providerCode);
  if (
    !provider?.ensureCustomer ||
    !provider.ensureSubscriptionPlan ||
    !provider.createSubscription ||
    !provider.getSubscription
  )
    return failure(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Paid subscription billing is unavailable in this environment.",
      command.requestId,
    );

  const repository = createPaymentRepository(database);
  const existingMapping = await database
    .prepare(
      `SELECT provider_subscription_reference FROM payment_provider_subscription
       WHERE subscription_id=? AND provider=?`,
    )
    .bind(command.subscription.subscriptionId, provider.code)
    .first<{ provider_subscription_reference: string }>();
  if (existingMapping) {
    const lookup = await provider.getSubscription(existingMapping.provider_subscription_reference);
    if (!lookup.ok) return failure("PROVIDER_LOOKUP_FAILED", lookup.errorCode, command.requestId);
    return {
      ok: true,
      value: withAction(command.subscription, provider.code, lookup.subscription),
      requestId: command.requestId,
    };
  }

  const profile = await database
    .prepare(
      `SELECT u.name, u.email, c.phone
       FROM customer c
       JOIN customer_principal cp ON cp.id=c.principal_id
       JOIN "user" u ON u.id=cp.auth_user_id
       WHERE c.id=?`,
    )
    .bind(command.customerId)
    .first<{ name: string; email: string; phone: string | null }>();
  if (!profile)
    return failure(
      "CONFIGURATION_ERROR",
      "Customer payment profile is unavailable",
      command.requestId,
    );
  const names = profile.name.trim().split(/\s+/);
  const firstName = names.shift() || "Customer";
  const lastName = names.join(" ") || "FreshMarkets";

  const existingCustomer = await repository.findProviderCustomer(command.customerId, provider.code);
  const customerResult = await provider.ensureCustomer({
    profile: {
      customerId: command.customerId,
      firstName,
      lastName,
      email: profile.email,
      phone: profile.phone,
    },
    existingProviderCustomerReference: existingCustomer,
    idempotencyKey: `fm-customer-${command.customerId}`,
  });
  if (!customerResult.ok)
    return failure("PAYMENT_FAILED", customerResult.errorCode, command.requestId);
  await repository.upsertProviderCustomer({
    customerId: command.customerId,
    provider: provider.code,
    providerCustomerRef: customerResult.providerCustomerReference,
    now: Date.now(),
  });

  const existingPlan = await database
    .prepare(
      `SELECT provider_plan_reference, amount_minor, currency, interval, interval_count
       FROM payment_provider_membership_plan
       WHERE provider=? AND membership_price_version_id=?`,
    )
    .bind(provider.code, command.priceVersionId)
    .first<{
      provider_plan_reference: string;
      amount_minor: number;
      currency: string;
      interval: string;
      interval_count: number;
    }>();
  if (
    existingPlan &&
    (existingPlan.amount_minor !== command.amountMinor ||
      existingPlan.currency !== command.currency ||
      existingPlan.interval !== "MONTHLY" ||
      existingPlan.interval_count !== 1)
  )
    return failure(
      "CONFIGURATION_ERROR",
      "The provider plan does not match the agreed membership price.",
      command.requestId,
    );
  const planResult = await provider.ensureSubscriptionPlan({
    priceVersionId: command.priceVersionId,
    name: command.offerName,
    description: `${command.offerName} calendar-month membership`,
    amountMinor: command.amountMinor,
    currency: command.currency,
    existingProviderPlanReference: existingPlan?.provider_plan_reference ?? null,
    idempotencyKey: `fm-plan-${command.priceVersionId}`,
  });
  if (!planResult.ok) return failure("PAYMENT_FAILED", planResult.errorCode, command.requestId);
  if (!existingPlan)
    await database
      .prepare(
        `INSERT INTO payment_provider_membership_plan
           (id, provider, membership_price_version_id, provider_plan_reference, amount_minor,
            currency, interval, interval_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'MONTHLY', 1, 'ACTIVE', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        provider.code,
        command.priceVersionId,
        planResult.providerPlanReference,
        command.amountMinor,
        command.currency,
        Date.now(),
        Date.now(),
      )
      .run();

  const created = await provider.createSubscription({
    providerCustomerReference: customerResult.providerCustomerReference,
    providerPlanReference: planResult.providerPlanReference,
    idempotencyKey: command.idempotencyKey,
  });
  if (!created.ok) return failure("PAYMENT_FAILED", created.errorCode, command.requestId);
  const view = created.subscription;
  const now = Date.now();
  try {
    await database
      .prepare(
        `INSERT INTO payment_provider_subscription
           (id, provider, subscription_id, customer_id, provider_subscription_reference,
            provider_plan_reference, provider_customer_reference, provider_status,
            latest_invoice_reference, next_billing_at, provider_observed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        provider.code,
        command.subscription.subscriptionId,
        command.customerId,
        view.providerSubscriptionReference,
        view.providerPlanReference,
        view.providerCustomerReference,
        view.providerStatus,
        view.latestInvoiceReference,
        view.nextBillingAt,
        now,
        now,
        now,
      )
      .run();
  } catch (error) {
    const recovered = await database
      .prepare(
        `SELECT provider_subscription_reference FROM payment_provider_subscription
         WHERE subscription_id=? AND provider=?`,
      )
      .bind(command.subscription.subscriptionId, provider.code)
      .first<{ provider_subscription_reference: string }>();
    if (
      !recovered ||
      recovered.provider_subscription_reference !== view.providerSubscriptionReference
    )
      throw error;
  }
  return {
    ok: true,
    value: withAction(command.subscription, provider.code, view),
    requestId: command.requestId,
  };
}

function withAction(
  subscription: SubscriptionSummary,
  providerCode: string,
  provider: ProviderSubscriptionView,
): SubscriptionSummary {
  if (
    provider.providerStatus !== "INCOMPLETE" ||
    !provider.providerPaymentReference ||
    !provider.clientToken
  )
    return subscription;
  return {
    ...subscription,
    paymentAction: {
      providerCode,
      providerReference: provider.providerPaymentReference,
      actionType: "SDK",
      clientToken: provider.clientToken,
      redirectUrl: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}
