import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { beginPaidEnrollment } from "../membership/application/get-membership-experience";
import { redrivePaymentReactions } from "../payments/application/redrive-payment-reactions";
import { reconcileStuckPayments } from "../payments/application/reconcile-stuck-payments";
import { ProviderRegistry } from "../payments/infrastructure/providers/provider-registry";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

let fixtureCounter = 0;

async function seedPendingPaidSubscription(): Promise<string> {
  const customerId = `cust-redrive-${++fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, NOW, NOW)
    .run();
  const enrollment = await beginPaidEnrollment(env.DB, {
    customerId,
    offerId: "offer-membership-monthly",
    idempotencyKey: `paid-enrollment-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!enrollment.ok) throw new Error(`fixture failed: ${enrollment.error.message}`);
  return enrollment.value.subscriptionId;
}

type ReactionType =
  | "ACTIVATE_MEMBERSHIP"
  | "RECOVER_MEMBERSHIP"
  | "COMMIT_ORDER"
  | "COMMIT_AMENDMENT";

async function seedReaction(input: {
  intentStatus: string;
  reactionType: ReactionType;
  subjectId?: string;
  status?: string;
  attempts?: number;
  availableAt?: number | null;
}): Promise<{ reactionId: string; intentId: string }> {
  const intentId = `pi-${++fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'MEMBERSHIP_ENROLLMENT', 'subscription', 'subj', 'cust-x', 29900, 'PHP', ?, ?, 1, ?, ?)",
  )
    .bind(intentId, input.intentStatus, `${intentId}-key`, NOW - MINUTE, NOW - MINUTE)
    .run();
  const reactionId = `react-${fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO payment_reaction (id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, 'subscription', ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      reactionId,
      intentId,
      input.reactionType,
      input.subjectId ?? "subj",
      input.status ?? "PENDING",
      `${reactionId}-key`,
      input.attempts ?? 1,
      input.availableAt === undefined ? NOW - 1_000 : input.availableAt,
      NOW - MINUTE,
      NOW - MINUTE,
    )
    .run();
  return { reactionId, intentId };
}

const registry = new ProviderRegistry("development");

describe("redrivePaymentReactions", () => {
  it("applies a due membership activation and marks the reaction succeeded", async () => {
    const subscriptionId = await seedPendingPaidSubscription();
    const { reactionId } = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "ACTIVATE_MEMBERSHIP",
      subjectId: subscriptionId,
    });
    const summary = await redrivePaymentReactions(env.DB, registry, NOW);
    expect(summary.applied).toBeGreaterThanOrEqual(1);
    const subscription = await env.DB.prepare("SELECT status FROM subscription WHERE id=?")
      .bind(subscriptionId)
      .first<{ status: string }>();
    expect(subscription?.status).toBe("ACTIVE");
    const reaction = await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
      .bind(reactionId)
      .first<{ status: string }>();
    expect(reaction?.status).toBe("SUCCEEDED");
  });

  it("leaves not-yet-due reactions untouched", async () => {
    const { reactionId } = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "ACTIVATE_MEMBERSHIP",
      subjectId: "sub-unused",
      availableAt: NOW + 10 * MINUTE,
    });
    await redrivePaymentReactions(env.DB, registry, NOW);
    const reaction = await env.DB.prepare(
      "SELECT status, attempts FROM payment_reaction WHERE id=?",
    )
      .bind(reactionId)
      .first<{ status: string; attempts: number }>();
    expect(reaction?.status).toBe("PENDING");
    expect(reaction?.attempts).toBe(1);
  });

  it("escalates exhausted reactions instead of retrying forever", async () => {
    const { reactionId, intentId } = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "RECOVER_MEMBERSHIP",
      attempts: 5,
    });
    const summary = await redrivePaymentReactions(env.DB, registry, NOW);
    expect(summary.escalated).toBeGreaterThanOrEqual(1);
    const reaction = await env.DB.prepare(
      "SELECT status, last_error_code FROM payment_reaction WHERE id=?",
    )
      .bind(reactionId)
      .first<{ status: string; last_error_code: string | null }>();
    expect(reaction?.status).toBe("ESCALATED");
    expect(reaction?.last_error_code).toBe("MAX_ATTEMPTS_EXCEEDED");
    const exception = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE' AND status='OPEN'",
    )
      .bind(intentId)
      .first<{ count: number }>();
    expect(exception?.count).toBe(1);
  });

  it("increments and schedules a failed paid-order commitment before bounded escalation", async () => {
    const { reactionId } = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      subjectId: "missing-checkout-attempt",
      attempts: 1,
    });
    await redrivePaymentReactions(env.DB, registry, NOW);
    const reaction = await env.DB.prepare(
      "SELECT status, attempts, available_at, last_error_code FROM payment_reaction WHERE id=?",
    )
      .bind(reactionId)
      .first<{
        status: string;
        attempts: number;
        available_at: number;
        last_error_code: string;
      }>();
    expect(reaction).toMatchObject({
      status: "PENDING",
      attempts: 2,
      last_error_code: "QUOTE_UNUSABLE",
    });
    expect(reaction?.available_at).toBeGreaterThan(NOW);
  });

  it("routes an insufficient-state order commitment through one provider lookup", async () => {
    const { reactionId } = await seedReaction({
      intentStatus: "PROCESSING",
      reactionType: "COMMIT_ORDER",
      subjectId: "attempt-1",
      availableAt: null,
    });
    const summary = await redrivePaymentReactions(env.DB, registry, NOW);
    expect(summary.reconciled).toBeGreaterThanOrEqual(1);
    const reaction = await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
      .bind(reactionId)
      .first<{ status: string }>();
    expect(reaction?.status).toBe("PENDING");
  });
});

describe("reconcileStuckPayments", () => {
  it("considers only stale pre-commitment intents and never throws on fresh ones", async () => {
    const staleId = `pi-stale-${++fixtureCounter}`;
    await env.DB.prepare(
      "INSERT INTO payment_intent (id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at) VALUES (?, 'GROCERY_CHECKOUT', 'checkout_attempt', 'att', 'cust-x', 50000, 'PHP', 'PROCESSING', ?, 1, ?, ?)",
    )
      .bind(staleId, `${staleId}-key`, NOW - 30 * MINUTE, NOW - 20 * MINUTE)
      .run();
    const summary = await reconcileStuckPayments(env.DB, registry, NOW);
    expect(summary.considered).toBeGreaterThanOrEqual(1);
    expect(summary.attempted).toBeGreaterThanOrEqual(1);
  });
});
