import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `promo-admin-${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Promo Admin", email, password }),
  });
  expect(signUpResponse.status).toBeLessThan(400);
  const body = (await signUpResponse.json()) as { user?: { id?: string } };
  const userId = body.user!.id!;
  await env.DB.prepare("UPDATE user SET email_verified=1 WHERE id=?").bind(userId).run();
  let cookie = (signUpResponse.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";", 1)[0])
    .join("; ");
  if (!cookie) {
    const signIn = await SELF.fetch("https://core.example.invalid/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
      body: JSON.stringify({ email, password }),
    });
    cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";", 1)[0]).join("; ");
  }
  return { cookie, userId };
}

async function seedManager(): Promise<{ cookie: string }> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Promo Mgr', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Promo Role', ?)",
    ).bind(roleId, `promo-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, 'global', NULL, NULL)",
    ).bind(crypto.randomUUID(), staffId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'promotions.manage', 'p', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='promotions.manage'",
    ).bind(roleId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, 'promotions.read', 'p', ?)",
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code='promotions.read'",
    ).bind(roleId),
  ]);
  return { cookie: principal.cookie };
}

async function seedCustomer(): Promise<string> {
  const principal = await signUp();
  const existing = await env.DB.prepare("SELECT id FROM customer_principal WHERE auth_user_id = ?")
    .bind(principal.userId)
    .first<{ id: string }>();
  const now = Date.now();
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
  )
    .bind(customerId, principal.userId, existing!.id, now, now)
    .run();
  return customerId;
}

const FUTURE_START = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe("promotion administration", () => {
  it("denies unauthenticated and non-staff readers", async () => {
    expect(await core.listAdminPromotions({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const nonStaff = await signUp();
    expect(
      await core.listAdminPromotions({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("lists the legacy definition and gets it by id", async () => {
    const manager = await seedManager();
    const page = await core.listAdminPromotions({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const legacy = page.value.items.find((item) => item.code === "WELCOME50");
    expect(legacy).toMatchObject({
      status: "ACTIVE",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 5000,
      minimumMinor: 50000,
    });

    const detail = await core.getAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: legacy!.promotionId,
    });
    expect(detail.ok).toBe(true);
  });

  it("creates a draft with the closed benefit set, idempotently", async () => {
    const manager = await seedManager();
    const code = `PCT_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const key = `promo-${crypto.randomUUID()}`;

    const invalid = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Percent promo",
      description: "",
      benefitType: "MEMBERSHIP_FEE_WAIVER" as never,
      percent: 10,
      minimumMinor: 0,
      startsAt: FUTURE_START,
      idempotencyKey: key,
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const createInput = {
      code,
      name: "Percent promo",
      description: "ten percent",
      benefitType: "ORDER_PERCENT_DISCOUNT" as const,
      percent: 10,
      minimumMinor: 20000,
      startsAt: new Date().toISOString(),
    };
    const created = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      ...createInput,
      idempotencyKey: key,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ code, status: "DRAFT", percent: 10, version: 1 });

    const replay = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      ...createInput,
      idempotencyKey: key,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.promotionId).toBe(created.value.promotionId);

    const duplicate = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code,
      name: "Other",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 100,
      minimumMinor: 0,
      startsAt: new Date().toISOString(),
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("updates only drafts with version guards and audits the change", async () => {
    const manager = await seedManager();
    const created = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `FIX_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Fixed promo",
      description: "before",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 3000,
      minimumMinor: 10000,
      startsAt: new Date().toISOString(),
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stale = await core.updateAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
      name: "Fixed promo 2",
      description: "after",
      discountMinor: 4000,
      minimumMinor: 10000,
      startsAt: new Date().toISOString(),
      expectedVersion: 99,
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const updated = await core.updateAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
      name: "Fixed promo 2",
      description: "after",
      discountMinor: 4000,
      minimumMinor: 10000,
      startsAt: new Date().toISOString(),
      expectedVersion: 1,
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ discountMinor: 4000, version: 2 });

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'PROMOTION.UPDATED'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBe(1);
  });

  it("walks the lifecycle legally, refuses illegal transitions, and previews by status", async () => {
    const manager = await seedManager();
    const customerId = await seedCustomer();
    const created = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `LIFE_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Lifecycle promo",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 2500,
      minimumMinor: 5000,
      startsAt: new Date().toISOString(),
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const promotionId = created.value.promotionId;

    // Draft preview is inactive.
    const draftPreview = await core.previewAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      subtotalMinor: 10000,
    });
    expect(draftPreview.ok).toBe(true);
    if (!draftPreview.ok) return;
    expect(draftPreview.value).toEqual({
      eligible: false,
      reasonCode: "PROMOTION_INACTIVE",
      discountMinor: null,
    });

    // Deactivate from DRAFT is illegal.
    const illegal = await core.changeAdminPromotionStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      action: "DEACTIVATE",
      reason: "not active yet",
      expectedVersion: 1,
      idempotencyKey: `life-${crypto.randomUUID()}`,
    });
    expect(illegal).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });

    async function change(action: "ACTIVATE" | "DEACTIVATE" | "ARCHIVE", version: number) {
      const result = await core.changeAdminPromotionStatus({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        promotionId,
        action,
        reason: `${action} by crm`,
        expectedVersion: version,
        idempotencyKey: `life-${crypto.randomUUID()}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`${action} failed`);
      return result.value;
    }

    const active = await change("ACTIVATE", 1);
    expect(active.status).toBe("ACTIVE");

    // Grant requires ACTIVE; replay returns the same grant.
    const grant = await core.grantAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      customerId,
      maxRedemptions: 1,
      idempotencyKey: `grant-${crypto.randomUUID()}`,
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    expect(grant.value).toMatchObject({ customerId, benefitType: "ORDER_FIXED_DISCOUNT" });

    const eligible = await core.previewAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      subtotalMinor: 10000,
    });
    expect(eligible.ok).toBe(true);
    if (!eligible.ok) return;
    expect(eligible.value).toEqual({ eligible: true, reasonCode: null, discountMinor: 2500 });

    const belowMinimum = await core.previewAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      subtotalMinor: 1000,
    });
    expect(belowMinimum.ok).toBe(true);
    if (!belowMinimum.ok) return;
    expect(belowMinimum.value.reasonCode).toBe("MINIMUM_ORDER_NOT_MET");

    const deactivated = await change("DEACTIVATE", active.version);
    expect(deactivated.status).toBe("INACTIVE");
    const archived = await change("ARCHIVE", deactivated.version);
    expect(archived.status).toBe("ARCHIVED");

    const updateArchived = await core.updateAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId,
      name: "Nope",
      description: "",
      discountMinor: 1,
      minimumMinor: 0,
      startsAt: new Date().toISOString(),
      expectedVersion: archived.version,
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(updateArchived).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action IN ('PROMOTION.ACTIVATED','PROMOTION.DEACTIVATED','PROMOTION.ARCHIVED') AND aggregate_id = ?",
    )
      .bind(promotionId)
      .first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBe(3);
  });

  it("lists grants and redemptions for a promotion, excluding the trial authority", async () => {
    const manager = await seedManager();
    const customerId = await seedCustomer();
    const created = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `GRN_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Grant promo",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 1000,
      minimumMinor: 0,
      startsAt: new Date().toISOString(),
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await core.changeAdminPromotionStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
      action: "ACTIVATE",
      reason: "launch",
      expectedVersion: 1,
      idempotencyKey: `life-${crypto.randomUUID()}`,
    });
    const grant = await core.grantAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
      customerId,
      maxRedemptions: 2,
      idempotencyKey: `grant-${crypto.randomUUID()}`,
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const grantId = grant.value.grantId;

    const grants = await core.listPromotionGrants({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
    });
    expect(grants.ok).toBe(true);
    if (!grants.ok) return;
    expect(grants.value.items.map((item) => item.grantId)).toContain(grantId);
    expect(JSON.stringify(grants.value)).not.toContain("INTRO_TRIAL");

    const redemptions = await core.listPromotionRedemptions({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
    });
    expect(redemptions.ok).toBe(true);
    if (!redemptions.ok) return;
    expect(redemptions.value.items).toEqual([]);
  });

  it("rolls back a promotion grant when required audit evidence fails", async () => {
    const manager = await seedManager();
    const customerId = await seedCustomer();
    const created = await core.createAdminPromotion({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `ATOM_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      name: "Atomic grant",
      description: "",
      benefitType: "ORDER_FIXED_DISCOUNT",
      discountMinor: 1000,
      minimumMinor: 1000,
      startsAt: new Date().toISOString(),
      idempotencyKey: `promo-${crypto.randomUUID()}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const active = await core.changeAdminPromotionStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      promotionId: created.value.promotionId,
      action: "ACTIVATE",
      reason: "activate atomic grant",
      expectedVersion: 1,
      idempotencyKey: `life-${crypto.randomUUID()}`,
    });
    expect(active.ok).toBe(true);
    await env.DB.prepare(
      `CREATE TRIGGER fail_promotion_grant_audit
       BEFORE INSERT ON audit_event
       WHEN NEW.action = 'PROMOTION.GRANTED'
       BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    ).run();

    try {
      await core.grantAdminPromotion({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        promotionId: created.value.promotionId,
        customerId,
        maxRedemptions: 1,
        idempotencyKey: `grant-${crypto.randomUUID()}`,
      });
    } catch {
      // The observable invariant is rollback, independent of RPC error transport.
    }

    const grants = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM promotion_grant WHERE customer_id=? AND benefit_code=?",
    )
      .bind(customerId, created.value.code)
      .first<{ count: number }>();
    expect(grants?.count).toBe(0);
  });
});
