import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applySubscriptionProviderEvent } from "./apply-subscription-provider-event";

describe("PayMongo subscription observations", () => {
  it("removes entitlement when PayMongo exhausts retries into unpaid", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `paymongo-customer-${suffix}`;
    const subscriptionId = `paymongo-subscription-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, `auth-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO subscription
             (id, customer_id, offer_id, status, starts_at, cancel_at_period_end,
              agreed_price_version_id, agreed_amount_minor, agreed_currency,
              version, created_at, updated_at)
           VALUES (?, ?, 'offer-membership-monthly', 'PAST_DUE', ?, 0,
                   'membership-price-version-1', 29900, 'PHP', 4, ?, ?)`,
      ).bind(subscriptionId, customerId, now, now, now),
      env.DB.prepare(
        `INSERT INTO payment_provider_subscription
             (id, provider, subscription_id, customer_id, provider_subscription_reference,
              provider_plan_reference, provider_customer_reference, provider_status,
              provider_observed_at, created_at, updated_at)
           VALUES (?, 'paymongo', ?, ?, ?, ?, ?, 'PAST_DUE', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        subscriptionId,
        customerId,
        `subs-${suffix}`,
        `plan-${suffix}`,
        `cus-${suffix}`,
        now - 1_000,
        now,
        now,
      ),
    ]);

    await expect(
      applySubscriptionProviderEvent(
        env.DB,
        {
          provider: "paymongo",
          providerEventId: `evt-${suffix}`,
          eventType: "subscription.unpaid",
          providerReference: `subs-${suffix}`,
          observedAt: now,
          payloadHash: "a".repeat(64),
          kind: "subscription",
          providerStatus: "UNPAID",
          providerCustomerReference: `cus-${suffix}`,
          providerPlanReference: `plan-${suffix}`,
          providerPaymentMethodReference: `pm-${suffix}`,
          latestInvoiceReference: `inv-${suffix}`,
          nextBillingAt: null,
        },
        now,
      ),
    ).resolves.toEqual({ processingStatus: "APPLIED", subscriptionId });

    const stored = await env.DB.prepare("SELECT status, version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; version: number }>();
    expect(stored).toEqual({ status: "UNPAID", version: 5 });
  });

  it("reconstructs legal intermediate states when an earlier provider webhook was missed", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `paymongo-customer-${suffix}`;
    const subscriptionId = `paymongo-subscription-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, `auth-${suffix}`, now, now),
      env.DB.prepare(
        `INSERT INTO subscription
             (id, customer_id, offer_id, status, starts_at, cancel_at_period_end,
              agreed_price_version_id, agreed_amount_minor, agreed_currency,
              version, created_at, updated_at)
           VALUES (?, ?, 'offer-membership-monthly', 'PENDING', ?, 0,
                   'membership-price-version-1', 29900, 'PHP', 1, ?, ?)`,
      ).bind(subscriptionId, customerId, now, now, now),
      env.DB.prepare(
        `INSERT INTO payment_provider_subscription
             (id, provider, subscription_id, customer_id, provider_subscription_reference,
              provider_plan_reference, provider_customer_reference, provider_status,
              provider_observed_at, created_at, updated_at)
           VALUES (?, 'paymongo', ?, ?, ?, ?, ?, 'INCOMPLETE', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        subscriptionId,
        customerId,
        `subs-${suffix}`,
        `plan-${suffix}`,
        `cus-${suffix}`,
        now - 1_000,
        now,
        now,
      ),
    ]);

    await expect(
      applySubscriptionProviderEvent(
        env.DB,
        {
          provider: "paymongo",
          providerEventId: `evt-${suffix}`,
          eventType: "subscription.unpaid",
          providerReference: `subs-${suffix}`,
          observedAt: now,
          payloadHash: "b".repeat(64),
          kind: "subscription",
          providerStatus: "UNPAID",
          providerCustomerReference: `cus-${suffix}`,
          providerPlanReference: `plan-${suffix}`,
          providerPaymentMethodReference: null,
          latestInvoiceReference: `inv-${suffix}`,
          nextBillingAt: null,
        },
        now,
      ),
    ).resolves.toEqual({ processingStatus: "APPLIED", subscriptionId });

    const stored = await env.DB.prepare("SELECT status, version FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string; version: number }>();
    expect(stored).toEqual({ status: "UNPAID", version: 3 });

    const events = await env.DB.prepare(
      "SELECT details_json FROM subscription_event WHERE subscription_id=? ORDER BY created_at, id",
    )
      .bind(subscriptionId)
      .all<{ details_json: string }>();
    expect(events.results).toHaveLength(2);
    expect(
      events.results.map(({ details_json }) => JSON.parse(details_json).transitionPath),
    ).toEqual([
      ["PENDING", "ACTIVE", "UNPAID"],
      ["PENDING", "ACTIVE", "UNPAID"],
    ]);
  });
});
