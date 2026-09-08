import { createMockPaymentProvider } from "../payments/infrastructure/providers/mock-payment-provider";
import { describe, expect, it, vi } from "vitest";
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
  it.each(["case", "audit"] as const)(
    "does not strand an escalated reaction when its required %s is ignored",
    async (kind) => {
      const f = await seedReaction({
        intentStatus: "SUCCEEDED",
        reactionType: "COMMIT_ORDER",
        subjectId: "missing-quote",
        attempts: 5,
      });
      await env.DB.exec(
        kind === "case"
          ? "CREATE TRIGGER ignore_escalation_effect BEFORE INSERT ON payment_reconciliation_case WHEN NEW.category='REACTION_FAILURE' BEGIN SELECT RAISE(IGNORE); END"
          : "CREATE TRIGGER ignore_escalation_effect BEFORE INSERT ON audit_event WHEN NEW.action='PAYMENT.REACTION_ESCALATED' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        await expect(redrivePaymentReactions(env.DB, registry, NOW)).rejects.toThrow();
        expect(
          await env.DB.prepare("SELECT status,attempts FROM payment_reaction WHERE id=?")
            .bind(f.reactionId)
            .first(),
        ).toEqual({ status: "PENDING", attempts: 5 });
        expect(
          await env.DB.prepare(
            "SELECT COUNT(*) n FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
          )
            .bind(f.intentId)
            .first(),
        ).toEqual({ n: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_escalation_effect");
      }
      expect(await redrivePaymentReactions(env.DB, registry, NOW)).toMatchObject({ escalated: 1 });
    },
  );
  it("claims a due reaction once across concurrent sweeps and keeps the last attempt leased", async () => {
    const { reactionId } = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      subjectId: "missing-quote",
      attempts: 0,
    });
    const leased = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      attempts: 5,
      availableAt: NOW + MINUTE,
    });
    await Promise.all([
      redrivePaymentReactions(env.DB, registry, NOW),
      redrivePaymentReactions(env.DB, registry, NOW),
    ]);
    expect(
      await env.DB.prepare("SELECT attempts,status FROM payment_reaction WHERE id=?")
        .bind(reactionId)
        .first(),
    ).toEqual({ attempts: 1, status: "PENDING" });
    expect(
      await env.DB.prepare("SELECT status FROM payment_reaction WHERE id=?")
        .bind(leased.reactionId)
        .first(),
    ).toEqual({ status: "PENDING" });
  });

  it("persists a thrown application failure, continues the batch and escalates it once", async () => {
    const failed = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      subjectId: "poisoned-quote",
      attempts: 0,
    });
    const later = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      subjectId: "another-missing-quote",
      attempts: 0,
    });
    await env.DB.prepare(`CREATE TRIGGER reject_finance_evidence BEFORE INSERT ON finance_exception
      WHEN NEW.payment_intent_id='${failed.intentId}' BEGIN SELECT RAISE(ABORT,'test-only application failure'); END`).run();
    try {
      await redrivePaymentReactions(env.DB, registry, NOW);
      expect(
        await env.DB.prepare("SELECT attempts,last_error_code FROM payment_reaction WHERE id=?")
          .bind(failed.reactionId)
          .first(),
      ).toEqual({ attempts: 1, last_error_code: "APPLICATION_FAILURE" });
      expect(
        await env.DB.prepare("SELECT attempts FROM payment_reaction WHERE id=?")
          .bind(later.reactionId)
          .first(),
      ).toEqual({ attempts: 1 });
      for (let attempt = 1; attempt < 6; attempt++)
        await redrivePaymentReactions(env.DB, registry, NOW + attempt * 16 * MINUTE);
      expect(
        await env.DB.prepare("SELECT status,attempts FROM payment_reaction WHERE id=?")
          .bind(failed.reactionId)
          .first(),
      ).toEqual({ status: "ESCALATED", attempts: 5 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM payment_reconciliation_case WHERE payment_intent_id=? AND category='REACTION_FAILURE'",
        )
          .bind(failed.intentId)
          .first(),
      ).toEqual({ count: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER reject_finance_evidence");
    }
  });

  it("records provider lookup failure without losing later due work", async () => {
    const failed = await seedReaction({
      intentStatus: "PROCESSING",
      reactionType: "COMMIT_ORDER",
      attempts: 0,
    });
    const later = await seedReaction({
      intentStatus: "SUCCEEDED",
      reactionType: "COMMIT_ORDER",
      attempts: 0,
    });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES ('cust-x','auth-cust-x','active',1,1)",
    ).run();
    await env.DB.prepare(`INSERT INTO payment_attempt
      (id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at)
      VALUES (?,'cust-x',?,29900,'PHP','PROCESSING','mock','throwing-reference',?,?,?)`)
      .bind(crypto.randomUUID(), failed.intentId, crypto.randomUUID(), NOW, NOW)
      .run();
    const provider = createMockPaymentProvider();
    provider.getPayment = vi.fn(async () => {
      throw new Error("provider private payload must not persist");
    });
    await redrivePaymentReactions(env.DB, new ProviderRegistry("test", [provider]), NOW);
    expect(provider.getPayment).toHaveBeenCalledOnce();
    expect(
      await env.DB.prepare("SELECT attempts,last_error_code FROM payment_reaction WHERE id=?")
        .bind(failed.reactionId)
        .first(),
    ).toEqual({ attempts: 1, last_error_code: "PROVIDER_LOOKUP_FAILED" });
    expect(
      await env.DB.prepare("SELECT attempts FROM payment_reaction WHERE id=?")
        .bind(later.reactionId)
        .first(),
    ).toEqual({ attempts: 1 });
  });

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
    const { reactionId, intentId } = await seedReaction({
      intentStatus: "PROCESSING",
      reactionType: "COMMIT_ORDER",
      subjectId: "attempt-1",
      availableAt: null,
    });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES ('cust-x','auth-cust-x','active',1,1)",
    ).run();
    const reference = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES (?,'cust-x',?,29900,'PHP','PROCESSING','mock',?,?,?,?)",
    )
      .bind(crypto.randomUUID(), intentId, reference, crypto.randomUUID(), NOW, NOW)
      .run();
    const provider = createMockPaymentProvider();
    provider.getPayment = vi.fn(async () => ({
      providerReference: reference,
      canonicalState: "PROCESSING" as const,
      amountMinor: 29900,
      currency: "PHP",
    }));
    const summary = await redrivePaymentReactions(
      env.DB,
      new ProviderRegistry("test", [provider]),
      NOW,
    );
    expect(provider.getPayment).toHaveBeenCalledOnce();
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
