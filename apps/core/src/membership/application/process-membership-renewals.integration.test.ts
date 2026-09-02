import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { processMembershipRenewals as processMembershipRenewalsCommand } from "./process-membership-renewals";
import { startPromotionalTrial } from "./start-promotional-trial";
import { beginPaidEnrollment } from "./get-membership-experience";
import { getSubscriptionEligibility } from "./subscription-eligibility";
import { addCalendarDays } from "../domain/billing-calendar";
import { createMockPaymentProvider } from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";

const DAY = 86_400_000;
let customerCounter = 0;

async function customer(): Promise<string> {
  const customerId = `cust-renew-${++customerCounter}-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, now, now)
    .run();
  return customerId;
}

async function seededTrial(options: { ended?: boolean } = {}): Promise<{
  customerId: string;
  subscriptionId: string;
}> {
  const customerId = await customer();
  const trial = await startPromotionalTrial(env.DB, {
    customerId,
    idempotencyKey: `trial-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!trial.ok) throw new Error(`fixture failed: ${trial.error.message}`);
  if (options.ended) {
    await env.DB.prepare("UPDATE subscription SET trial_ends_at=? WHERE id=?")
      .bind(Date.now() - DAY, trial.value.subscriptionId)
      .run();
  }
  return { customerId, subscriptionId: trial.value.subscriptionId };
}

async function seededActive(options: { due?: boolean } = {}): Promise<{
  customerId: string;
  subscriptionId: string;
}> {
  const customerId = await customer();
  const enrollment = await beginPaidEnrollment(env.DB, {
    customerId,
    offerId: "offer-membership-monthly",
    idempotencyKey: `paid-enrollment-${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  if (!enrollment.ok) throw new Error(`fixture failed: ${enrollment.error.message}`);
  const now = Date.now();
  const authorizationId = `authz-${customerId}`;
  await env.DB.prepare(
    "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
  )
    .bind(
      authorizationId,
      customerId,
      `mock_auth_${customerId}`,
      `mock_method_${customerId}`,
      now,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "UPDATE subscription SET status='ACTIVE', payment_authorization_id=?, nominal_billing_day=1, billing_starts_at=?, current_period_starts_at=?, current_period_ends_at=? WHERE id=?",
  )
    .bind(
      authorizationId,
      now - 31 * DAY,
      now - 31 * DAY,
      options.due ? now - DAY : now + DAY,
      enrollment.value.subscriptionId,
    )
    .run();
  return { customerId, subscriptionId: enrollment.value.subscriptionId };
}

function testRegistry(): ProviderRegistry {
  return new ProviderRegistry("test", [createMockPaymentProvider()]);
}

function processMembershipRenewals(database: D1Database, registry: ProviderRegistry, now: number) {
  return processMembershipRenewalsCommand(database, registry, now, {
    initiationEnabled: true,
  });
}

async function subscriptionRow(subscriptionId: string) {
  return env.DB.prepare(
    "SELECT customer_id, status, grace_ends_at, ended_at, renewal_initiated_through, trial_ends_at, current_period_ends_at FROM subscription WHERE id=?",
  )
    .bind(subscriptionId)
    .first<{
      customer_id: string;
      status: string;
      grace_ends_at: number | null;
      ended_at: number | null;
      renewal_initiated_through: number | null;
      trial_ends_at: number | null;
      current_period_ends_at: number | null;
    }>();
}

async function renewalIntents(subscriptionId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, status FROM payment_intent WHERE subject_id=? AND purpose='MEMBERSHIP_RENEWAL'",
  )
    .bind(subscriptionId)
    .all<{ id: string; status: string }>();
  return rows.results;
}

describe("membership renewal processing", () => {
  it("expires a due free trial without creating a payment", async () => {
    const fixture = await seededTrial({ ended: true });
    const trialEnd = (await subscriptionRow(fixture.subscriptionId))!.trial_ends_at!;
    const outcome = await processMembershipRenewalsCommand(env.DB, testRegistry(), Date.now(), {
      initiationEnabled: false,
    });
    expect(outcome).toMatchObject({ trialsExpired: 1, initiated: 0 });
    expect(await renewalIntents(fixture.subscriptionId)).toHaveLength(0);
    const row = await subscriptionRow(fixture.subscriptionId);
    expect(row).toMatchObject({ status: "EXPIRED", ended_at: trialEnd });
  });

  it("allows explicit paid enrollment only as a new aggregate after trial expiry", async () => {
    const fixture = await seededTrial({ ended: true });
    await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    const enrollment = await beginPaidEnrollment(env.DB, {
      customerId: fixture.customerId,
      offerId: "offer-membership-monthly",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });
    expect(enrollment).toMatchObject({ ok: true, value: { state: "PENDING" } });
    if (!enrollment.ok) return;
    expect(enrollment.value.subscriptionId).not.toBe(fixture.subscriptionId);
    const rows = await env.DB.prepare(
      "SELECT status FROM subscription WHERE customer_id=? ORDER BY created_at ASC",
    )
      .bind(fixture.customerId)
      .all<{ status: string }>();
    expect(rows.results.map((row) => row.status)).toEqual(["EXPIRED", "PENDING"]);
  });

  it("does not initiate a paid renewal when ownership is disabled", async () => {
    const fixture = await seededActive({ due: true });
    const outcome = await processMembershipRenewalsCommand(env.DB, testRegistry(), Date.now(), {
      initiationEnabled: false,
    });
    expect(outcome).toMatchObject({ initiated: 0, initiationSkipped: true });
    expect(await renewalIntents(fixture.subscriptionId)).toHaveLength(0);
    await env.DB.prepare("UPDATE subscription SET current_period_ends_at=? WHERE id=?")
      .bind(Date.now() + DAY, fixture.subscriptionId)
      .run();
  });

  it("initiates one paid renewal at the active period boundary", async () => {
    const fixture = await seededActive({ due: true });
    const now = Date.now();
    const first = await processMembershipRenewals(env.DB, testRegistry(), now);
    expect(first.initiated).toBe(1);
    expect(await renewalIntents(fixture.subscriptionId)).toHaveLength(1);
    const row = await subscriptionRow(fixture.subscriptionId);
    expect(row?.renewal_initiated_through).toBe(row?.current_period_ends_at);
    const second = await processMembershipRenewals(env.DB, testRegistry(), now + 30_000);
    expect(second.initiated).toBe(0);
    expect(await renewalIntents(fixture.subscriptionId)).toHaveLength(1);
  });

  it("renews at the paid subscription's agreed price", async () => {
    const fixture = await seededActive({ due: true });
    await env.DB.prepare(
      "UPDATE subscription_offer SET fee_minor=24900 WHERE id='offer-membership-monthly'",
    ).run();
    await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    const intent = await env.DB.prepare(
      "SELECT amount_minor, currency FROM payment_intent WHERE subject_id=? AND purpose='MEMBERSHIP_RENEWAL'",
    )
      .bind(fixture.subscriptionId)
      .first<{ amount_minor: number; currency: string }>();
    expect(intent).toEqual({ amount_minor: 29_900, currency: "PHP" });
  });

  it("does not initiate while a trial or paid period is still running", async () => {
    const trial = await seededTrial();
    const paid = await seededActive();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(outcome.initiated).toBe(0);
    expect(await renewalIntents(trial.subscriptionId)).toHaveLength(0);
    expect(await renewalIntents(paid.subscriptionId)).toHaveLength(0);
  });

  it("moves ACTIVE to PAST_DUE with a 7-calendar-day grace on confirmed failure", async () => {
    const fixture = await seededActive({ due: true });
    await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    const intents = await renewalIntents(fixture.subscriptionId);
    expect(intents).toHaveLength(1);
    const failedAt = Date.now();
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED', updated_at=? WHERE id=?")
      .bind(failedAt, intents[0]!.id)
      .run();
    const applied = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(applied.failureOutcomesApplied).toBe(1);
    const row = await subscriptionRow(fixture.subscriptionId);
    expect(row?.status).toBe("PAST_DUE");
    expect(row?.grace_ends_at).toBe(
      Date.parse(addCalendarDays(new Date(failedAt).toISOString(), 7, "Asia/Manila")),
    );
    const eligibility = await getSubscriptionEligibility(env.DB, {
      customerId: fixture.customerId,
      requestId: crypto.randomUUID(),
      headers: { "x-test-context": "renewals" },
    });
    expect(eligibility.value).toMatchObject({ eligible: true, state: "PAST_DUE" });
    const again = await processMembershipRenewals(env.DB, testRegistry(), Date.now());
    expect(again.failureOutcomesApplied).toBe(0);
  });

  it("never treats a creation-time operational failure as a payment failure", async () => {
    const fixture = await seededActive({ due: true });
    const outcome = await processMembershipRenewals(
      env.DB,
      new ProviderRegistry("test"),
      Date.now(),
    );
    expect(outcome.initiationFailures).toBe(1);
    expect((await subscriptionRow(fixture.subscriptionId))?.status).toBe("ACTIVE");
    await env.DB.prepare("UPDATE subscription SET current_period_ends_at=? WHERE id=?")
      .bind(Date.now() + DAY, fixture.subscriptionId)
      .run();
  });

  it("expires PAST_DUE when grace is exhausted and no charge is in flight", async () => {
    const fixture = await seededActive();
    const now = Date.now();
    await env.DB.prepare("UPDATE subscription SET status='PAST_DUE', grace_ends_at=? WHERE id=?")
      .bind(now - 1_000, fixture.subscriptionId)
      .run();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), now);
    expect(outcome.graceExpired).toBe(1);
    const row = await subscriptionRow(fixture.subscriptionId);
    expect(row).toMatchObject({ status: "EXPIRED", ended_at: now });
  });

  it("keeps PAST_DUE while a renewal charge is in flight past grace", async () => {
    const fixture = await seededActive({ due: true });
    const now = Date.now();
    await processMembershipRenewals(env.DB, testRegistry(), now);
    const intents = await renewalIntents(fixture.subscriptionId);
    await env.DB.prepare("UPDATE subscription SET status='PAST_DUE', grace_ends_at=? WHERE id=?")
      .bind(now - 1_000, fixture.subscriptionId)
      .run();
    const outcome = await processMembershipRenewals(env.DB, testRegistry(), now);
    expect(["INITIATED", "REQUIRES_ACTION", "PROCESSING"]).toContain(intents[0]!.status);
    expect(outcome.graceExpired).toBe(0);
    expect((await subscriptionRow(fixture.subscriptionId))?.status).toBe("PAST_DUE");
  });
});
