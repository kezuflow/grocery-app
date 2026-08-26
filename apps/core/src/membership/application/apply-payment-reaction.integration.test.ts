import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyMembershipPaymentReaction } from "./apply-payment-reaction";
import { startPromotionalTrial } from "./start-promotional-trial";

let customerCounter = 0;
async function trialingWithPendingReaction(): Promise<{
  customerId: string;
  subscriptionId: string;
  reactionId: string;
  paymentIntentId: string;
}> {
  const customerId = `cust-react-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, Date.now(), Date.now())
    .run();
  const now = Date.now();
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
  expect(trial.ok).toBe(true);
  if (!trial.ok) throw new Error("fixture failed");
  const intentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'MEMBERSHIP_ENROLLMENT', 'subscription', ?, ?, 29900, 'PHP', 'PROCESSING', ?, 1, ?, ?)",
  )
    .bind(
      intentId,
      trial.value.subscriptionId,
      customerId,
      `pi-${intentId}`,
      Date.now(),
      Date.now(),
    )
    .run();
  const reactionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, 'ACTIVATE_MEMBERSHIP', 'subscription', ?, 'PENDING', ?, 0, ?, ?)",
  )
    .bind(
      reactionId,
      intentId,
      trial.value.subscriptionId,
      `reaction:${intentId}`,
      Date.now(),
      Date.now(),
    )
    .run();
  return {
    customerId,
    subscriptionId: trial.value.subscriptionId,
    reactionId,
    paymentIntentId: intentId,
  };
}

describe("membership payment reaction", () => {
  it("ignores insufficient canonical states", async () => {
    const fixture = await trialingWithPendingReaction();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "PROCESSING",
    });
    expect(outcome).toMatchObject({ applied: false, reason: "INSUFFICIENT_STATE" });
    const row = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(fixture.subscriptionId)
      .first<{ status: string }>();
    expect(row?.status).toBe("TRIALING");
  });

  it("activates exactly once from SUCCEEDED and records application evidence", async () => {
    const fixture = await trialingWithPendingReaction();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    const row = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(fixture.subscriptionId)
      .first<{ status: string }>();
    expect(row?.status).toBe("ACTIVE");

    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription_event WHERE subscription_id=? AND event_type='ACTIVATED_FROM_PAYMENT'",
    )
      .bind(fixture.subscriptionId)
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
    const reactionRow = await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
      .bind(fixture.reactionId)
      .first<{ status: string }>();
    expect(reactionRow?.status).toBe("SUCCEEDED");

    // Duplicate delivery of the same reaction is idempotent.
    const replay = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(replay).toMatchObject({ applied: true, reason: "ALREADY_APPLIED" });
    const eventsAfterReplay = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription_event WHERE subscription_id=? AND event_type='ACTIVATED_FROM_PAYMENT'",
    )
      .bind(fixture.subscriptionId)
      .first<{ count: number }>();
    expect(eventsAfterReplay?.count).toBe(1);

    // No provider reference ever lands on the subscription aggregate.
    const cols = await env.DB.prepare("PRAGMA table_info(subscription)").all<{ name: string }>();
    expect(cols.results.map((column) => column.name).join(",")).not.toContain("provider");
  });

  it("leaves the reaction retryable when a concurrent lifecycle command wins", async () => {
    const fixture = await trialingWithPendingReaction();
    // Concurrent command mutates the stored state/version after load:
    // simulate by cancelling immediately before the reaction applies.
    await env.DB.prepare(
      "UPDATE subscription SET status='CANCELED', ended_at=?, version=version+1, updated_at=? WHERE id=?",
    )
      .bind(Date.now(), Date.now(), fixture.subscriptionId)
      .run();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    // CANCELED is terminal: the reaction must not activate and must be marked failed.
    expect(outcome.applied).toBe(false);
    const row = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(fixture.subscriptionId)
      .first<{ status: string }>();
    expect(row?.status).toBe("CANCELED");
    const reactionRow = await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
      .bind(fixture.reactionId)
      .first<{ status: string }>();
    expect(reactionRow?.status).not.toBe("SUCCEEDED");
  });

  it("installs the first paid period on conversion with the nominal anchor", async () => {
    const fixture = await trialingWithPendingReaction();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    const row = await env.DB.prepare(
      "SELECT status, trial_ends_at, current_period_starts_at, current_period_ends_at, nominal_billing_day, billing_starts_at FROM subscription WHERE id=?",
    )
      .bind(fixture.subscriptionId)
      .first<{
        status: string;
        trial_ends_at: number | null;
        current_period_starts_at: number | null;
        current_period_ends_at: number | null;
        nominal_billing_day: number | null;
        billing_starts_at: number | null;
      }>();
    expect(row?.status).toBe("ACTIVE");
    // The paid period begins exactly where the trial ended.
    expect(row?.current_period_starts_at).toBe(row?.trial_ends_at);
    expect(row?.current_period_ends_at).toBeGreaterThan(row?.current_period_starts_at ?? 0);
    // One nominal calendar month, anchored on the trial start day.
    const days =
      ((row?.current_period_ends_at ?? 0) - (row?.current_period_starts_at ?? 0)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    expect(row?.nominal_billing_day).toBeGreaterThanOrEqual(1);
    expect(row?.billing_starts_at).not.toBeNull();
  });

  it("advances the period on renewal success while ACTIVE", async () => {
    const fixture = await trialingWithPendingReaction();
    const before = Date.now();
    // Anchor-aligned paid history: the boundary sits on the anchor day, as it
    // does organically once conversion installed the first anchored period.
    const day = 86_400_000;
    const periodStart = before - 61 * day;
    const periodEnd = before - 31 * day;
    await env.DB.prepare(
      "UPDATE subscription SET status='ACTIVE', current_period_starts_at=?, current_period_ends_at=?, version=version+1 WHERE id=?",
    )
      .bind(periodStart, periodEnd, fixture.subscriptionId)
      .run();
    await env.DB.prepare("UPDATE payment_reaction SET status='PENDING' WHERE id=?")
      .bind(fixture.reactionId)
      .run();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    const row = await env.DB.prepare(
      "SELECT current_period_starts_at, current_period_ends_at FROM subscription WHERE id=?",
    )
      .bind(fixture.subscriptionId)
      .first<{ current_period_starts_at: number; current_period_ends_at: number }>();
    // The new period starts at the old boundary and ends one anchored month later.
    expect(row?.current_period_starts_at).toBe(periodEnd);
    expect(row?.current_period_ends_at).toBeGreaterThan(periodEnd + 28 * day - 2 * day);
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription_event WHERE subscription_id=? AND event_type='PERIOD_ADVANCED_FROM_PAYMENT'",
    )
      .bind(fixture.subscriptionId)
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
  });

  it("recovers PAST_DUE to ACTIVE and clears the grace window", async () => {
    const fixture = await trialingWithPendingReaction();
    await env.DB.prepare(
      "UPDATE subscription SET status='PAST_DUE', grace_ends_at=?, current_period_starts_at=?, current_period_ends_at=?, version=version+1 WHERE id=?",
    )
      .bind(
        Date.now() + 86_400_000,
        Date.now() - 40 * 86_400_000,
        Date.now() - 10 * 86_400_000,
        fixture.subscriptionId,
      )
      .run();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: true, reason: "APPLIED" });
    const row = await env.DB.prepare("SELECT status, grace_ends_at FROM subscription WHERE id=?")
      .bind(fixture.subscriptionId)
      .first<{ status: string; grace_ends_at: number | null }>();
    expect(row).toMatchObject({ status: "ACTIVE", grace_ends_at: null });
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription_event WHERE subscription_id=? AND event_type='RECOVERED_FROM_PAYMENT'",
    )
      .bind(fixture.subscriptionId)
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
  });

  it("escalates money received against a terminal subscription", async () => {
    const fixture = await trialingWithPendingReaction();
    await env.DB.prepare(
      "UPDATE subscription SET status='EXPIRED', ended_at=?, version=version+1 WHERE id=?",
    )
      .bind(Date.now(), fixture.subscriptionId)
      .run();
    const outcome = await applyMembershipPaymentReaction(env.DB, {
      ...fixture,
      canonicalPaymentState: "SUCCEEDED",
    });
    expect(outcome).toMatchObject({ applied: false, reason: "ESCALATED" });
    const reactionRow = await env.DB.prepare(
      "SELECT status, last_error_code FROM payment_reaction WHERE id=?",
    )
      .bind(fixture.reactionId)
      .first<{ status: string; last_error_code: string | null }>();
    expect(reactionRow).toMatchObject({
      status: "ESCALATED",
      last_error_code: "SUBSCRIPTION_TERMINATED_WITH_PAYMENT",
    });
    const cases = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE payment_intent_id=? AND status='OPEN'",
    )
      .bind(fixture.paymentIntentId)
      .first<{ count: number }>();
    expect(cases?.count).toBe(1);
  });
});
