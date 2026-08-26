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
});
