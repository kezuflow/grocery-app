import type { PaymentProviderRegistry } from "../ports/provider-registry";

export async function cancelProviderSubscription(
  database: D1Database,
  registry: PaymentProviderRegistry,
  subscriptionId: string,
  reason: "too_expensive" | "missing_features" | "switched_service" | "unused" | "other" = "other",
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  const mapping = await database
    .prepare(
      `SELECT provider, provider_subscription_reference, provider_status
       FROM payment_provider_subscription WHERE subscription_id=?`,
    )
    .bind(subscriptionId)
    .first<{
      provider: string;
      provider_subscription_reference: string;
      provider_status: string;
    }>();
  if (!mapping || mapping.provider_status === "CANCELED") return { ok: true };
  const provider = registry.get(mapping.provider);
  if (!provider?.cancelSubscription) return { ok: false, errorCode: "PROVIDER_CANCEL_UNAVAILABLE" };
  const result = await provider.cancelSubscription({
    providerSubscriptionReference: mapping.provider_subscription_reference,
    reason,
  });
  if (!result.ok) return result;
  if (result.subscription.providerStatus !== "CANCELED")
    return { ok: false, errorCode: "PROVIDER_CANCEL_NOT_CONFIRMED" };
  const now = Date.now();
  await database
    .prepare(
      `UPDATE payment_provider_subscription
       SET provider_status='CANCELED', provider_observed_at=?, updated_at=?
       WHERE subscription_id=? AND provider=?`,
    )
    .bind(now, now, subscriptionId, mapping.provider)
    .run();
  return { ok: true };
}
