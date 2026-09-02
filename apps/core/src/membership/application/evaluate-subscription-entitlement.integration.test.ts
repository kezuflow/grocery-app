import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { evaluateSubscriptionEntitlement } from "./evaluate-subscription-entitlement";

const AT = Date.parse("2026-08-30T04:00:00.000Z");

type SeedOptions = {
  status: string;
  trialEndsAt?: number | null;
  currentPeriodEndsAt?: number | null;
  graceEndsAt?: number | null;
  updatedAt?: number;
};

async function seedCustomer(): Promise<string> {
  const customerId = `cust-entitlement-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, AT - 10_000, AT - 10_000)
    .run();
  return customerId;
}

async function seedSubscription(customerId: string, options: SeedOptions): Promise<string> {
  const offer = await env.DB.prepare(
    "SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'",
  ).first<{ id: string }>();
  const subscriptionId = `sub-entitlement-${crypto.randomUUID()}`;
  const updatedAt = options.updatedAt ?? AT - 1_000;
  await env.DB.prepare(
    `INSERT INTO subscription (
      id, customer_id, offer_id, status, starts_at, trial_ends_at,
      current_period_ends_at, grace_ends_at, cancel_at_period_end,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
  )
    .bind(
      subscriptionId,
      customerId,
      offer!.id,
      options.status,
      AT - 86_400_000,
      options.trialEndsAt ?? null,
      options.currentPeriodEndsAt ?? null,
      options.graceEndsAt ?? null,
      updatedAt,
      updatedAt,
    )
    .run();
  return subscriptionId;
}

describe("canonical subscription entitlement", () => {
  it("returns NO_SUBSCRIPTION when the customer has no subscription", async () => {
    const customerId = await seedCustomer();

    await expect(evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT })).resolves.toEqual({
      eligible: false,
      state: null,
      effectiveUntil: null,
      reason: "NO_SUBSCRIPTION",
    });
  });

  it("treats TRIALING as entitled only strictly before trial end", async () => {
    const beforeCustomer = await seedCustomer();
    await seedSubscription(beforeCustomer, { status: "TRIALING", trialEndsAt: AT + 1 });
    const exactCustomer = await seedCustomer();
    await seedSubscription(exactCustomer, { status: "TRIALING", trialEndsAt: AT });

    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId: beforeCustomer, at: AT }),
    ).resolves.toMatchObject({
      eligible: true,
      state: "TRIALING",
      effectiveUntil: AT + 1,
      reason: "ENTITLED",
    });
    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId: exactCustomer, at: AT }),
    ).resolves.toMatchObject({
      eligible: false,
      state: "TRIALING",
      effectiveUntil: AT,
      reason: "TRIAL_ENDED",
    });
  });

  it("keeps a paid ACTIVE subscription entitled even with legacy trial timestamps", async () => {
    const customerId = await seedCustomer();
    await seedSubscription(customerId, {
      status: "ACTIVE",
      trialEndsAt: AT - 86_400_000,
      currentPeriodEndsAt: AT + 86_400_000,
    });

    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT }),
    ).resolves.toMatchObject({
      eligible: true,
      state: "ACTIVE",
      effectiveUntil: AT + 86_400_000,
      reason: "ENTITLED",
    });
  });

  it("expires ACTIVE at an explicit paid-period end", async () => {
    const customerId = await seedCustomer();
    await seedSubscription(customerId, {
      status: "ACTIVE",
      trialEndsAt: AT + 86_400_000,
      currentPeriodEndsAt: AT,
    });

    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT }),
    ).resolves.toMatchObject({
      eligible: false,
      state: "ACTIVE",
      effectiveUntil: AT,
      reason: "STATE_NOT_ENTITLED",
    });
  });

  it("keeps PAST_DUE entitled until a verified provider state removes access", async () => {
    const customerId = await seedCustomer();
    await seedSubscription(customerId, { status: "PAST_DUE", graceEndsAt: AT });

    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT }),
    ).resolves.toMatchObject({ eligible: true, reason: "ENTITLED", effectiveUntil: null });
  });

  it.each(["PENDING", "UNPAID", "PAUSED", "CANCELED", "EXPIRED"])(
    "keeps %s ineligible",
    async (status) => {
      const customerId = await seedCustomer();
      await seedSubscription(customerId, { status });

      await expect(
        evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT }),
      ).resolves.toMatchObject({
        eligible: false,
        state: status,
        effectiveUntil: null,
        reason: "STATE_NOT_ENTITLED",
      });
    },
  );

  it("selects the latest lifecycle aggregate deterministically", async () => {
    const customerId = await seedCustomer();
    await seedSubscription(customerId, { status: "CANCELED", updatedAt: AT - 2_000 });
    await seedSubscription(customerId, {
      status: "ACTIVE",
      currentPeriodEndsAt: AT + 86_400_000,
      updatedAt: AT - 1_000,
    });

    await expect(
      evaluateSubscriptionEntitlement(env.DB, { customerId, at: AT }),
    ).resolves.toMatchObject({ eligible: true, state: "ACTIVE", reason: "ENTITLED" });
  });
});
