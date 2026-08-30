import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { beginPaidEnrollment, getMembershipExperience } from "./get-membership-experience";

async function customer(): Promise<string> {
  const id = `cust-experience-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(id, `auth-${id}`, Date.now(), Date.now())
    .run();
  return id;
}

describe("customer Membership experience", () => {
  it("loads the canonical offer and requires recurring authorization before trial", async () => {
    const result = await getMembershipExperience(env.DB, {
      customerId: await customer(),
      requestId: crypto.randomUUID(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        offer: {
          code: "MEMBERSHIP_MONTHLY",
          amountMinor: 29900,
          currency: "PHP",
          billingInterval: "CALENDAR_MONTH",
        },
        subscription: null,
        introductoryTrial: {
          eligible: false,
          status: "AUTHORIZATION_REQUIRED",
          duration: "CALENDAR_MONTH",
        },
        recurringAuthorization: { ready: false, status: "REQUIRED" },
        actions: {
          startTrial: { available: false, disabledReason: "RECURRING_AUTHORIZATION_REQUIRED" },
          beginPaidEnrollment: { available: true, disabledReason: null },
        },
      },
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("provider");
  });

  it("derives redeemed trial status and lifecycle actions from Core state", async () => {
    const customerId = await customer();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, cancel_at_period_end, version, created_at, updated_at) VALUES (?, ?, 'offer-membership-monthly', 'ACTIVE', ?, 0, 4, ?, ?)",
      ).bind(`sub-${customerId}`, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, subject_type, subject_id, redeemed_at) VALUES (?, 'grant-introductory-trial', 'INTRO_TRIAL', 'MEMBERSHIP_FEE_WAIVER', ?, 'subscription', ?, ?)",
      ).bind(`redemption-${customerId}`, customerId, `sub-${customerId}`, now),
      env.DB.prepare(
        "INSERT INTO payment_authorization (id, customer_id, provider, provider_authorization_ref, provider_method_ref, recurring_capable, status, established_at, created_at, updated_at) VALUES (?, ?, 'mock', ?, ?, 1, 'ACTIVE', ?, ?, ?)",
      ).bind(
        `authorization-${customerId}`,
        customerId,
        `ref-${customerId}`,
        `method-${customerId}`,
        now,
        now,
        now,
      ),
    ]);
    const result = await getMembershipExperience(env.DB, {
      customerId,
      requestId: crypto.randomUUID(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        subscription: { state: "ACTIVE", version: 4 },
        introductoryTrial: { eligible: false, status: "REDEEMED" },
        recurringAuthorization: { ready: true, status: "READY" },
        actions: {
          pause: { available: true, disabledReason: null },
          resume: { available: false, disabledReason: "SUBSCRIPTION_NOT_PAUSED" },
          cancelImmediately: { available: true, disabledReason: null },
          cancelAtPeriodEnd: { available: true, disabledReason: null },
        },
      },
    });
  });

  it("begins paid enrollment as PENDING and replays the same command", async () => {
    const customerId = await customer();
    const command = {
      customerId,
      offerId: "offer-membership-monthly",
      idempotencyKey: `paid-enrollment-${crypto.randomUUID()}`,
      requestId: crypto.randomUUID(),
    };
    const first = await beginPaidEnrollment(env.DB, command);
    expect(first).toMatchObject({ ok: true, value: { state: "PENDING", version: 1 } });
    const replay = await beginPaidEnrollment(env.DB, command);
    expect(replay).toEqual(first);
    const row = await env.DB.prepare(
      "SELECT status, trial_ends_at FROM subscription WHERE customer_id=?",
    )
      .bind(customerId)
      .first<{ status: string; trial_ends_at: number | null }>();
    expect(row).toEqual({ status: "PENDING", trial_ends_at: null });
  });

  it("conflicts when a paid-enrollment key is reused for another offer", async () => {
    const customerId = await customer();
    const idempotencyKey = `paid-enrollment-${crypto.randomUUID()}`;
    await beginPaidEnrollment(env.DB, {
      customerId,
      offerId: "offer-membership-monthly",
      idempotencyKey,
      requestId: crypto.randomUUID(),
    });
    const conflict = await beginPaidEnrollment(env.DB, {
      customerId,
      offerId: "different-offer",
      idempotencyKey,
      requestId: crypto.randomUUID(),
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });
});
