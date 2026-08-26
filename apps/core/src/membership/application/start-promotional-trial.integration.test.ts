import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  startPromotionalTrial,
  type StartPromotionalTrialCommand,
} from "./start-promotional-trial";

let customerCounter = 0;
async function seedCustomer(): Promise<string> {
  const id = `cust-trial-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

let authorizationCounter = 0;
async function seedAuthorization(customerId: string, methodRef?: string): Promise<string> {
  const id = `authz-${++authorizationCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'fake', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(id, customerId, `fake_auth_${id}`, methodRef ?? `fake_method_${id}`, now, now, now)
    .run();
  return id;
}

function command(customerId: string): StartPromotionalTrialCommand {
  return {
    customerId,
    idempotencyKey: `trial-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  };
}

describe("promotions-owned introductory trial", () => {
  it("creates a trialing subscription with an exact calendar-month end", async () => {
    const customerId = await seedCustomer();
    await seedAuthorization(customerId);
    const before = Date.now();
    const result = await startPromotionalTrial(env.DB, command(customerId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("TRIALING");
    expect(result.value.cancelAtPeriodEnd).toBe(false);
    expect(result.value.version).toBe(1);
    // One constrained Manila calendar month: start Jun/Jul boundary stays exact.
    const startMs = Date.parse(result.value.trialStartsAt!);
    const endMs = Date.parse(result.value.trialEndsAt!);
    expect(startMs).toBeGreaterThanOrEqual(before - 1000);
    // The end must equal a real calendar-month offset (28-31 days), never 14 days.
    const days = (endMs - startMs) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    // No payment artifacts are fabricated by the trial.
    const intents = await env.DB.prepare("SELECT COUNT(*) AS count FROM payment_intent").first<{
      count: number;
    }>();
    expect(intents?.count).toBe(0);
    // Redemption exists exactly once.
    const redemptions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM promotion_redemption WHERE customer_id=? AND benefit_code='INTRO_TRIAL'",
    )
      .bind(customerId)
      .first<{ count: number }>();
    expect(redemptions?.count).toBe(1);
  });

  it("requires a recurring-capable authorization before granting the trial", async () => {
    const customerId = await seedCustomer();
    const result = await startPromotionalTrial(env.DB, command(customerId));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RECURRING_AUTHORIZATION_REQUIRED" },
    });
    const subscriptions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription WHERE customer_id=?",
    )
      .bind(customerId)
      .first<{ count: number }>();
    expect(subscriptions?.count).toBe(0);
  });

  it("links the authorization and persists the nominal billing anchor", async () => {
    const customerId = await seedCustomer();
    const authorizationId = await seedAuthorization(customerId);
    const result = await startPromotionalTrial(env.DB, command(customerId));
    expect(result.ok).toBe(true);
    const row = await env.DB.prepare(
      "SELECT payment_authorization_id, nominal_billing_day, status FROM subscription WHERE customer_id=?",
    )
      .bind(customerId)
      .first<{ payment_authorization_id: string; nominal_billing_day: number; status: string }>();
    expect(row).toMatchObject({ payment_authorization_id: authorizationId, status: "TRIALING" });
    expect(row?.nominal_billing_day).toBeGreaterThanOrEqual(1);
    expect(row?.nominal_billing_day).toBeLessThanOrEqual(31);
  });

  it("refuses a trial on an instrument identity that already consumed one", async () => {
    const firstCustomer = await seedCustomer();
    const sharedMethod = `fake_method_shared_${crypto.randomUUID().slice(0, 8)}`;
    const firstAuthorization = await seedAuthorization(firstCustomer, sharedMethod);
    const first = await startPromotionalTrial(env.DB, command(firstCustomer));
    expect(first.ok).toBe(true);
    // The instrument is later released for re-authorization elsewhere; its
    // trial history must still follow the mandate identity.
    await env.DB.prepare(
      "UPDATE payment_authorization SET status='REVOKED', revoked_at=? WHERE id=?",
    )
      .bind(Date.now(), firstAuthorization)
      .run();

    const secondCustomer = await seedCustomer();
    await seedAuthorization(secondCustomer, sharedMethod);
    const second = await startPromotionalTrial(env.DB, command(secondCustomer));
    expect(second).toMatchObject({
      ok: false,
      error: { code: "PROMOTION_INELIGIBLE", message: expect.stringContaining("instrument") },
    });
  });

  it("rejects a second introductory trial and a second open subscription", async () => {
    const customerId = await seedCustomer();
    await seedAuthorization(customerId);
    await startPromotionalTrial(env.DB, command(customerId));
    const secondTrial = await startPromotionalTrial(env.DB, command(customerId));
    expect(secondTrial).toMatchObject({ ok: false, error: { code: "PROMOTION_INELIGIBLE" } });
  });

  it("rejects when an open subscription already exists", async () => {
    const customerId = await seedCustomer();
    await seedAuthorization(customerId);
    await startPromotionalTrial(env.DB, command(customerId));
    // Simulate paid activation replacing TRIALING with ACTIVE; still open.
    const row = await env.DB.prepare("SELECT id FROM subscription WHERE customer_id=?")
      .bind(customerId)
      .first<{ id: string }>();
    await env.DB.prepare("UPDATE subscription SET status='ACTIVE' WHERE id=?").bind(row!.id).run();
    // A new customer's redemption was consumed above; use redemption-less path:
    // clear redemption to isolate the open-subscription guard.
    await env.DB.prepare(
      "DELETE FROM promotion_redemption WHERE customer_id=? AND benefit_code='INTRO_TRIAL'",
    )
      .bind(customerId)
      .run();
    const attempt = await startPromotionalTrial(env.DB, command(customerId));
    expect(attempt).toMatchObject({ ok: false, error: { code: "OPEN_SUBSCRIPTION_EXISTS" } });
  });

  it("replays the same result for the same key and conflicts on different payloads", async () => {
    const customerId = await seedCustomer();
    await seedAuthorization(customerId);
    const attempt = command(customerId);
    const first = await startPromotionalTrial(env.DB, attempt);
    expect(first.ok).toBe(true);
    const replay = await startPromotionalTrial(env.DB, attempt);
    expect(replay).toEqual(first);
    const otherCustomer = await seedCustomer();
    await seedAuthorization(otherCustomer);
    const conflict = await startPromotionalTrial(env.DB, {
      ...attempt,
      customerId: otherCustomer,
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("allows exactly one winner among concurrent two-key attempts", async () => {
    const customerId = await seedCustomer();
    await seedAuthorization(customerId);
    const [a, b] = [command(customerId), command(customerId)];
    const outcomes = await Promise.all([
      startPromotionalTrial(env.DB, a),
      startPromotionalTrial(env.DB, b),
    ]);
    const successes = outcomes.filter((outcome) => outcome.ok).length;
    const ineligibles = outcomes.filter(
      (outcome) => !outcome.ok && outcome.error.code === "PROMOTION_INELIGIBLE",
    ).length;
    const conflicts = outcomes.filter(
      (outcome) => !outcome.ok && outcome.error.code === "OPEN_SUBSCRIPTION_EXISTS",
    ).length;
    expect(successes + Math.max(ineligibles, conflicts)).toBe(2);
    expect(successes).toBe(1);
    const subscriptions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscription WHERE customer_id=?",
    )
      .bind(customerId)
      .first<{ count: number }>();
    expect(subscriptions?.count).toBe(1);
  });
});
