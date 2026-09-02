import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { processMembershipRenewals } from "./process-membership-renewals";

async function seedTrial(trialEndsAt: number) {
  const now = Date.now();
  const customerId = `customer-${crypto.randomUUID()}`;
  const subscriptionId = `subscription-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    ).bind(customerId, `auth-${customerId}`, now, now),
    env.DB.prepare(
      "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, trial_ends_at, cancel_at_period_end, version, created_at, updated_at) VALUES (?, ?, 'offer-membership-monthly', 'TRIALING', ?, ?, 0, 1, ?, ?)",
    ).bind(subscriptionId, customerId, trialEndsAt - 1_000, trialEndsAt, now, now),
  ]);
  return subscriptionId;
}

describe("membership time processing", () => {
  it("expires an ended introductory trial exactly once without creating a payment", async () => {
    const now = Date.now();
    const subscriptionId = await seedTrial(now);

    expect(await processMembershipRenewals(env.DB, now)).toEqual({ trialsExpired: 1 });
    expect(await processMembershipRenewals(env.DB, now)).toEqual({ trialsExpired: 0 });

    const subscription = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string }>();
    expect(subscription?.status).toBe("EXPIRED");
    const payments = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_intent WHERE subject_id=?",
    )
      .bind(subscriptionId)
      .first<{ count: number }>();
    expect(payments?.count).toBe(0);
  });

  it("does not expire a future introductory trial", async () => {
    const now = Date.now();
    await seedTrial(now + 60_000);
    expect(await processMembershipRenewals(env.DB, now)).toEqual({ trialsExpired: 0 });
  });
});
