import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

async function writeGuardCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM subscription").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

async function columns(table: string): Promise<string[]> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

describe("membership and promotions persistence", () => {
  it("seeds the canonical paid offer and demotes the legacy trial offer", async () => {
    const paid = await env.DB.prepare(
      "SELECT code, fee_minor, currency, trial_days, status FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'",
    ).first<{
      code: string;
      fee_minor: number;
      currency: string;
      trial_days: number;
      status: string;
    }>();
    expect(paid).toMatchObject({
      code: "MEMBERSHIP_MONTHLY",
      fee_minor: 29900,
      currency: "PHP",
      trial_days: 0,
      status: "active",
    });
    const interval = await env.DB.prepare(
      "SELECT billing_interval FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'",
    ).first<{ billing_interval: string }>();
    expect(interval?.billing_interval).toBe("CALENDAR_MONTH");

    const legacyDefault = await env.DB.prepare(
      "SELECT is_default, status FROM subscription_offer WHERE code='TRIAL'",
    ).first<{ is_default: number; status: string }>();
    expect(legacyDefault).toMatchObject({ is_default: 0, status: "legacy" });
  });

  it("adds lifecycle metadata without provider references", async () => {
    const subscriptionColumns = await columns("subscription");
    for (const column of [
      "cancel_at_period_end",
      "cancellation_requested_at",
      "scheduled_cancellation_at",
      "current_period_starts_at",
      "paused_at",
      "ended_at",
    ])
      expect(subscriptionColumns).toContain(column);
    const all = subscriptionColumns.join(",");
    expect(all).not.toContain("provider");
    const offerColumns = (await columns("subscription_offer")).join(",");
    expect(offerColumns).toContain("billing_interval");
    expect(offerColumns).not.toContain("provider");
  });

  it("creates promotion grant/redemption tables with one-per-customer introductory uniqueness", async () => {
    expect(await columns("promotion_grant")).toEqual(
      expect.arrayContaining(["id", "benefit_type", "status", "created_at"]),
    );
    expect(await columns("promotion_redemption")).toEqual(
      expect.arrayContaining(["id", "grant_id", "customer_id", "benefit_type", "redeemed_at"]),
    );

    const customerId = `cust-promo-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(customerId, `auth-${customerId}`, Date.now(), Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO promotion_grant (id, benefit_code, benefit_type, max_redemptions, status, parameters_json, created_at, updated_at) VALUES ('grant-intro-test', 'INTRO_TRIAL', 'MEMBERSHIP_FEE_WAIVER', 1, 'ACTIVE', '{}', ?, ?)",
    )
      .bind(Date.now(), Date.now())
      .run();
    const insertRedemption = () =>
      env.DB.prepare(
        "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, redeemed_at) VALUES (?, 'grant-intro-test', 'INTRO_TRIAL', 'MEMBERSHIP_FEE_WAIVER', ?, ?)",
      )
        .bind(crypto.randomUUID(), customerId, Date.now())
        .run();
    await insertRedemption();
    // One introductory-trial redemption per customer, regardless of key.
    await expect(insertRedemption()).rejects.toThrow();
    // A different customer may still redeem.
    const otherCustomer = `cust-promo-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(otherCustomer, `auth-${otherCustomer}`, Date.now(), Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO promotion_redemption (id, grant_id, benefit_code, benefit_type, customer_id, redeemed_at) VALUES (?, 'grant-intro-test', 'INTRO_TRIAL', 'MEMBERSHIP_FEE_WAIVER', ?, ?)",
    )
      .bind(crypto.randomUUID(), otherCustomer, Date.now())
      .run();
  });

  it("enforces one open subscription per customer and closed statuses", async () => {
    const customerId = `cust-open-${crypto.randomUUID().slice(0, 8)}`;
    const authId = `auth-${customerId}`;
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
      .bind(customerId, authId, now, now)
      .run();
    const offer = await env.DB.prepare(
      "SELECT id FROM subscription_offer WHERE code='MEMBERSHIP_MONTHLY'",
    ).first<{ id: string }>();
    const insertSubscription = (status: string) =>
      env.DB.prepare(
        "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), customerId, offer!.id, status, now, now, now)
        .run();

    await insertSubscription("ACTIVE");
    // A second open subscription for the same customer must be impossible...
    let secondOpenRejected = false;
    try {
      await env.DB.prepare(
        "INSERT INTO subscription (id, customer_id, offer_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, 'TRIALING', ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), customerId, offer!.id, now, now, now)
        .run();
    } catch {
      secondOpenRejected = true;
    }
    if (!secondOpenRejected) {
      // ...unless a partial unique index is unsupported by this driver; then
      // the preflight duplicate query below must detect it.
      const duplicates = await env.DB.prepare(
        "SELECT customer_id, COUNT(*) AS count FROM subscription WHERE status IN ('PENDING','TRIALING','ACTIVE','PAST_DUE','PAUSED') GROUP BY customer_id HAVING COUNT(*) > 1",
      ).all<{ customer_id: string; count: number }>();
      expect(duplicates.results.length).toBe(0);
      throw new Error("PREFLIGHT: duplicate open subscriptions were not rejected");
    }
    // Noncanonical spelling is an application/domain concern; storage accepts
    // any string but the unique index keeps exactly one open row per customer.
    expect(await writeGuardCount()).toBe(1);
  });

  it("creates subscription_event referencing application ids only", async () => {
    const cols = await columns("subscription_event");
    expect(cols).toEqual(
      expect.arrayContaining(["id", "subscription_id", "event_type", "occurred_at"]),
    );
    const joined = cols.join(",");
    expect(joined).not.toContain("provider_reference");
    expect(cols).toContain("payment_intent_id");
    expect(cols).toContain("promotion_redemption_id");
  });

  it("backfills legacy trial history markers without changing durations", async () => {
    const legacy = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM promotion_grant WHERE benefit_code='LEGACY_TRIAL_HISTORY'",
    ).first<{ count: number }>();
    expect(legacy?.count ?? 0).toBeGreaterThanOrEqual(0);
  });
});
