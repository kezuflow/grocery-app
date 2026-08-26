import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { processMembershipRenewals } from "./process-membership-renewals";
import { startPromotionalTrial } from "./start-promotional-trial";
import { getSubscriptionEligibility } from "./subscription-eligibility";
import { addCalendarDays } from "../domain/billing-calendar";
import { createFakePaymentProvider } from "../../payments/infrastructure/providers/fake-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";

const DAY = 86_400_000;

let customerCounter = 0;
async function seededTrial(options: { trialEnded?: boolean } = {}): Promise<string> {
  const customerId = `cust-renew-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'fake', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(
      `authz-${customerId}`,
      customerId,
      `fake_auth_${customerId}`,
      `fake_method_${customerId}`,
      now,
      now,
      now,
    )
    .run();
  const trial = await startPromotionalTrial(env.DB, {
    customerId,
    idempotencyKey: `trial-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!trial.ok) throw new Error(`fixture failed: ${trial.error.message}`);
  if (options.trialEnded) {
    await env.DB.prepare(
      "UPDATE subscription SET trial_ends_at=?, current_period_starts_at=?, current_period_ends_at=? WHERE id=?",
    )
      .bind(now - DAY, now - DAY, now - DAY, trial.value.subscriptionId)
      .run();
  }
  return trial.value.subscriptionId;
}

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createFakePaymentProvider()]);
}

function eligibilityQuery(customerIdOfRow: { customer_id: string }) {
  return {
    customerId: customerIdOfRow.customer_id,
    requestId: crypto.randomUUID(),
    headers: { "x-test-context": "renewals" },
  };
}

async function subscriptionRow(subscriptionId: string) {
  return env.DB.prepare(
    "SELECT customer_id, status, grace_ends_at, ended_at, renewal_initiated_through, trial_ends_at FROM subscription WHERE id=?",
  )
    .bind(subscriptionId)
    .first<{
      customer_id: string;
      status: string;
      grace_ends_at: number | null;
      ended_at: number | null;
      renewal_initiated_through: number | null;
      trial_ends_at: number | null;
    }>();
}

async function renewalIntents(subscriptionId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, status FROM payment_intent WHERE subject_id=? AND purpose='MEMBERSHIP_RENEWAL'",
  )
    .bind(subscriptionId)
    .all<{ id: string; status: string }>();
  return rows.results.filter((row) => row.id !== undefined);
}

describe("membership renewal processing", () => {
  it("initiates the first renewal charge once at the trial boundary", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    const now = Date.now();
    const first = await processMembershipRenewals(env.DB, testRegistry(), now);
    expect(first.initiated).toBe(1);
    const intents = await renewalIntents(subscriptionId);
    expect(intents.length).toBe(1);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.renewal_initiated_through).toBe(row?.trial_ends_at);

    // Repeated/overlapping runs never create a second intent for the period.
    const second = await processMembershipRenewals(env.DB, testRegistry(), now + 30_000);
    expect(second.initiated).toBe(0);
    expect(await renewalIntents(subscriptionId)).toHaveLength(1);
  });

  it("does not initiate while the trial or paid period is still running", async () => {
    await seededTrial();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(outcome.initiated).toBe(0);
  });

  it("moves ACTIVE to PAST_DUE with a 7-calendar-day grace on confirmed failure", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    const intents = await renewalIntents(subscriptionId);
    expect(intents).toHaveLength(1);
    // Simulate the canonical provider-confirmed failure observation.
    const failedAt = Date.now();
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED', updated_at=? WHERE id=?")
      .bind(failedAt, intents[0].id)
      .run();
    await env.DB.prepare("UPDATE subscription SET status='ACTIVE' WHERE id=?")
      .bind(subscriptionId)
      .run();

    const applied = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(applied.failureOutcomesApplied).toBe(1);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.status).toBe("PAST_DUE");
    const expectedGrace = Date.parse(
      addCalendarDays(new Date(failedAt).toISOString(), 7, "Asia/Manila"),
    );
    expect(row?.grace_ends_at).toBe(expectedGrace);

    // Checkout eligibility persists inside grace.
    const eligibility = await getSubscriptionEligibility(
      env.DB,
      eligibilityQuery((await subscriptionRow(subscriptionId))!),
    );
    expect(eligibility.value).toMatchObject({ eligible: true, state: "PAST_DUE" });

    // Re-applying the same failed outcome is a no-op.
    const again = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(again.failureOutcomesApplied).toBe(0);
  });

  it("expires an uncontinued trial on a failed first conversion", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    const intents = await renewalIntents(subscriptionId);
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED', updated_at=? WHERE id=?")
      .bind(Date.now(), intents[0].id)
      .run();
    const applied = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(applied.failureOutcomesApplied).toBe(1);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.status).toBe("EXPIRED");
    expect(row?.grace_ends_at).toBeNull();
  });

  it("never treats a creation-time operational failure as a payment failure", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    // No provider configured: initiation fails operationally and the intent is
    // marked FAILED without any provider attempt row.
    const outcome = await processMembershipRenewals(
      env.DB,
      new ProviderRegistry("test"),
      Date.now(),
    );
    expect(outcome.initiationFailures).toBe(1);
    const intents = await renewalIntents(subscriptionId);
    expect(intents).toHaveLength(1);
    expect(intents[0].status).toBe("FAILED");
    const applied = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(applied.failureOutcomesApplied).toBe(0);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.status).toBe("TRIALING");
  });

  it("expires PAST_DUE when grace is exhausted and no charge is in flight", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    const now = Date.now();
    await env.DB.prepare("UPDATE subscription SET status='PAST_DUE', grace_ends_at=? WHERE id=?")
      .bind(now - 1_000, subscriptionId)
      .run();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), now);
    expect(outcome.graceExpired).toBe(1);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.status).toBe("EXPIRED");
    expect(row?.ended_at).toBe(now);
  });

  it("keeps PAST_DUE while a renewal charge is still in flight past grace", async () => {
    const subscriptionId = await seededTrial({ trialEnded: true });
    const now = Date.now();
    await processMembershipRenewals(env.DB, testRegistry(), now);
    const intents = await renewalIntents(subscriptionId);
    await env.DB.prepare("UPDATE subscription SET status='PAST_DUE', grace_ends_at=? WHERE id=?")
      .bind(now - 1_000, subscriptionId)
      .run();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), now);
    // The renewal intent is still in flight (REQUIRES_ACTION here), so expiry
    // must not fire.
    expect(["INITIATED", "REQUIRES_ACTION", "PROCESSING"]).toContain(intents[0].status);
    expect(outcome.graceExpired).toBe(0);
    const row = await subscriptionRow(subscriptionId);
    expect(row?.status).toBe("PAST_DUE");
  });
});
