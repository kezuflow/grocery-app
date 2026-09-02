import { applySubscriptionProviderEvent } from "./apply-subscription-provider-event";
import type { PaymentProviderRegistry } from "../ports/provider-registry";

export type ProviderSubscriptionReconciliationResult = {
  inspected: number;
  applied: number;
  unchanged: number;
  failed: number;
};

/**
 * Recover subscription state that could be missed while a PayMongo webhook is
 * disabled or unavailable. This only retrieves provider truth; it never asks
 * PayMongo to retry a charge.
 */
export async function reconcileProviderSubscriptions(
  database: D1Database,
  registry: PaymentProviderRegistry,
  now = Date.now(),
  limit = 50,
): Promise<ProviderSubscriptionReconciliationResult> {
  const rows = await database
    .prepare(
      `SELECT provider, provider_subscription_reference
       FROM payment_provider_subscription
       WHERE provider_status IN ('INCOMPLETE','ACTIVE','PAST_DUE','UNPAID')
       ORDER BY updated_at ASC LIMIT ?`,
    )
    .bind(limit)
    .all<{ provider: string; provider_subscription_reference: string }>();
  const result = { inspected: rows.results.length, applied: 0, unchanged: 0, failed: 0 };
  for (const row of rows.results) {
    const provider = registry.get(row.provider);
    if (!provider?.getSubscription) {
      result.failed += 1;
      continue;
    }
    const lookup = await provider.getSubscription(row.provider_subscription_reference);
    if (!lookup.ok) {
      result.failed += 1;
      continue;
    }
    const view = lookup.subscription;
    const application = await applySubscriptionProviderEvent(
      database,
      {
        provider: row.provider,
        providerEventId: `reconcile:${row.provider_subscription_reference}:${Math.floor(now / 900_000)}`,
        eventType: "subscription.reconciled",
        providerReference: view.providerSubscriptionReference,
        observedAt: now,
        payloadHash: "reconciliation",
        kind: "subscription",
        providerStatus: view.providerStatus,
        providerCustomerReference: view.providerCustomerReference,
        providerPlanReference: view.providerPlanReference,
        providerPaymentMethodReference: null,
        latestInvoiceReference: view.latestInvoiceReference,
        nextBillingAt: view.nextBillingAt,
      },
      now,
    );
    if (application.processingStatus === "APPLIED") result.applied += 1;
    else if (application.processingStatus === "DUPLICATE") result.unchanged += 1;
    else result.failed += 1;
  }
  return result;
}
