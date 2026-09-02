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
  it("loads the canonical offer and makes the free trial available without authorization", async () => {
    const result = await getMembershipExperience(env.DB, {
      customerId: await customer(),
      requestId: crypto.randomUUID(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        offer: {
          code: "MEMBERSHIP_MONTHLY",
          priceVersionId: "membership-price-version-1",
          priceVersion: 1,
          amountMinor: 29900,
          currency: "PHP",
          billingInterval: "CALENDAR_MONTH",
        },
        subscription: null,
        introductoryTrial: {
          eligible: true,
          status: "AVAILABLE",
          duration: "CALENDAR_MONTH",
        },
        recurringAuthorization: { ready: false, status: "REQUIRED" },
        actions: {
          startTrial: { available: true, disabledReason: null },
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
      "SELECT status, trial_ends_at, agreed_price_version_id, agreed_amount_minor, agreed_currency FROM subscription WHERE customer_id=?",
    )
      .bind(customerId)
      .first<{
        status: string;
        trial_ends_at: number | null;
        agreed_price_version_id: string;
        agreed_amount_minor: number;
        agreed_currency: string;
      }>();
    expect(row).toEqual({
      status: "PENDING",
      trial_ends_at: null,
      agreed_price_version_id: "membership-price-version-1",
      agreed_amount_minor: 29_900,
      agreed_currency: "PHP",
    });
  });

  it("grandfathers existing subscriptions when the global price changes", async () => {
    const firstCustomer = await customer();
    const first = await beginPaidEnrollment(env.DB, {
      customerId: firstCustomer,
      offerId: "offer-membership-monthly",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });
    expect(first.ok).toBe(true);

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE membership_price_version SET effective_to=? WHERE id='membership-price-version-1'",
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO membership_price_version
          (id, offer_id, amount_minor, currency, effective_from, effective_to, version, created_at)
         VALUES ('membership-price-version-test-2', 'offer-membership-monthly', 24900, 'PHP', ?, NULL, 2, ?)`,
      ).bind(now, now),
    ]);

    const secondCustomer = await customer();
    const second = await beginPaidEnrollment(env.DB, {
      customerId: secondCustomer,
      offerId: "offer-membership-monthly",
      idempotencyKey: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    });
    expect(second.ok).toBe(true);
    const prices = await env.DB.prepare(
      "SELECT customer_id, agreed_amount_minor FROM subscription WHERE customer_id IN (?, ?) ORDER BY customer_id",
    )
      .bind(firstCustomer, secondCustomer)
      .all<{ customer_id: string; agreed_amount_minor: number }>();
    expect(
      new Map(prices.results.map((row) => [row.customer_id, row.agreed_amount_minor])),
    ).toEqual(
      new Map([
        [firstCustomer, 29_900],
        [secondCustomer, 24_900],
      ]),
    );
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
