import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getSubscriptionEligibility } from "./subscription-eligibility";

let customerCounter = 0;
async function seedCustomerWithSubscription(
  status: string,
  columns: {
    trialEndsAt?: number | null;
    currentPeriodEndsAt?: number | null;
    graceEndsAt?: number | null;
  },
): Promise<string> {
  const customerId = `cust-elig-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  const offer = await env.DB.prepare(
    "SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'",
  ).first<{ id: string }>();
  await env.DB.prepare(
    "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, current_period_ends_at, grace_ends_at, cancel_at_period_end, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      customerId,
      offer!.id,
      status,
      now,
      columns.trialEndsAt ?? null,
      columns.currentPeriodEndsAt ?? null,
      columns.graceEndsAt ?? null,
      now,
      now,
    )
    .run();
  return customerId;
}

function query(customerId: string) {
  return {
    customerId,
    requestId: crypto.randomUUID(),
    headers: { "x-test-context": "subscription-eligibility" },
  };
}

describe("subscription checkout eligibility with grace", () => {
  it("keeps TRIALING eligible before the exact trial end", async () => {
    const customerId = await seedCustomerWithSubscription("TRIALING", {
      trialEndsAt: Date.now() + 86_400_000,
    });
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: true, state: "TRIALING" });
  });

  it("guards the exact instant: a passed trial end is ineligible", async () => {
    const customerId = await seedCustomerWithSubscription("TRIALING", {
      trialEndsAt: Date.now() - 1_000,
    });
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: false, state: "TRIALING" });
  });

  it("keeps a paid ACTIVE subscription eligible even with legacy trial timestamps", async () => {
    const customerId = await seedCustomerWithSubscription("ACTIVE", {
      trialEndsAt: Date.now() - 86_400_000,
      currentPeriodEndsAt: Date.now() + 86_400_000,
    });
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: true, state: "ACTIVE" });
  });

  it("keeps PAST_DUE eligible while the provider retry cycle is active", async () => {
    const customerId = await seedCustomerWithSubscription("PAST_DUE", {
      graceEndsAt: Date.now() + 3_600_000,
    });
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: true, state: "PAST_DUE" });
  });

  it("does not use a historical local grace timestamp as billing authority", async () => {
    const customerId = await seedCustomerWithSubscription("PAST_DUE", { graceEndsAt: 0 });
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: true, state: "PAST_DUE" });
  });

  it("removes eligibility when PayMongo exhausts retries", async () => {
    const customerId = await seedCustomerWithSubscription("UNPAID", {});
    const result = await getSubscriptionEligibility(env.DB, query(customerId));
    expect(result.value).toMatchObject({ eligible: false, state: "UNPAID" });
  });

  it("keeps terminal and pending states ineligible", async () => {
    for (const status of ["CANCELED", "EXPIRED", "PAUSED", "PENDING"]) {
      const customerId = await seedCustomerWithSubscription(status, {});
      const result = await getSubscriptionEligibility(env.DB, query(customerId));
      expect(result.value).toMatchObject({ eligible: false, state: status });
    }
  });
});
