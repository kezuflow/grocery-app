import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";

const core = exports.default as unknown as CoreServiceBinding;

let counter = 0;

async function signUp(): Promise<{ cookie: string; userId: string }> {
  const n = ++counter;
  const email = `cat-admin-${n}-${crypto.randomUUID().slice(0, 12)}@example.com`;
  const password = "correct-horse-battery-staple";
  const signUpResponse = await SELF.fetch("https://core.example.invalid/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://core.example.invalid" },
    body: JSON.stringify({ name: "Catalog Admin", email, password }),
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

const CATALOG_CAPABILITIES = [
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.adjust",
];

async function seedManager(options: { scope?: "global" | "location" } = {}): Promise<{
  cookie: string;
  staffId: string;
}> {
  const principal = await signUp();
  const staffId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    env.DB.prepare(
      "INSERT INTO staff_identity (id, auth_user_id, display_name, status, created_at, updated_at) VALUES (?, ?, 'Catalog Mgr', 'active', ?, ?)",
    ).bind(staffId, principal.userId, now, now),
    env.DB.prepare(
      "INSERT INTO role (id, code, name, created_at) VALUES (?, ?, 'Cat Role', ?)",
    ).bind(roleId, `cat-${crypto.randomUUID().slice(0, 8)}`, now),
    env.DB.prepare("INSERT INTO staff_role (staff_id, role_id) VALUES (?, ?)").bind(
      staffId,
      roleId,
    ),
    env.DB.prepare(
      "INSERT INTO staff_scope (id, staff_id, scope_kind, market_id, location_id) VALUES (?, ?, ?, NULL, ?)",
    ).bind(
      crypto.randomUUID(),
      staffId,
      options.scope ?? "global",
      options.scope === "location" ? "location-cebu-central" : null,
    ),
  ];
  for (const capability of CATALOG_CAPABILITIES) {
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO permission (id, code, description, created_at) VALUES (?, ?, 'cat', ?)",
      ).bind(crypto.randomUUID(), capability, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO role_permission (role_id, permission_id) SELECT ?, id FROM permission WHERE code=?",
      ).bind(roleId, capability),
    );
  }
  await env.DB.batch(statements);
  return { cookie: principal.cookie, staffId };
}

/** Seed one product (no SKUs) with an active category and gram pool. */
async function seedProduct(): Promise<{
  productId: string;
  poolId: string;
  unitGramId: string;
  unitKgId: string;
}> {
  const now = Date.now();
  const categoryId = crypto.randomUUID();
  const poolId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const unitGramId = crypto.randomUUID();
  const unitKgId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO category (id, code, name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, 'Test Cat', ?, 'active', 50, ?, ?)",
    ).bind(
      categoryId,
      `TC_${crypto.randomUUID().slice(0, 12)}`,
      `test-cat-${crypto.randomUUID().slice(0, 12)}`,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO unit (id, code, name, dimension, symbol, created_at) VALUES (?, ?, 'Gram', 'MASS', 'g', ?)",
    ).bind(unitGramId, `GRAM_T_${crypto.randomUUID().slice(0, 12)}`, now),
    env.DB.prepare(
      "INSERT INTO unit (id, code, name, dimension, symbol, created_at) VALUES (?, ?, 'Kilogram', 'MASS', 'kg', ?)",
    ).bind(unitKgId, `KG_T_${crypto.randomUUID().slice(0, 12)}`, now),
    env.DB.prepare(
      "INSERT INTO inventory_pool (id, product_id, base_unit_id, sourcing_mode, created_at, updated_at) VALUES (?, ?, ?, 'STOCKED', ?, ?)",
    ).bind(poolId, productId, unitGramId, now, now),
    env.DB.prepare(
      "INSERT INTO product (id, category_id, inventory_pool_id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    ).bind(
      productId,
      categoryId,
      poolId,
      `test-prod-${crypto.randomUUID().slice(0, 12)}`,
      `Test Product ${crypto.randomUUID().slice(0, 12)}`,
      now,
      now,
    ),
  ]);
  return { productId, poolId, unitGramId, unitKgId };
}

describe("catalog administration", () => {
  it("denies unauthenticated and non-staff readers", async () => {
    expect(await core.listAdminProducts({ requestId: "r1", headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const nonStaff = await signUp();
    expect(
      await core.listAdminProducts({
        requestId: crypto.randomUUID(),
        headers: { cookie: nonStaff.cookie },
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("creates a category and a unit idempotently with conflicts on duplicates", async () => {
    const manager = await seedManager();
    const categoryKey = `cat-${crypto.randomUUID()}`;
    const created = await core.createAdminCategory({
      requestId: "cat-" + crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `TEST_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      name: "Test Category",
      slug: `test-${crypto.randomUUID().slice(0, 12)}`,
      sortOrder: 90,
      idempotencyKey: categoryKey,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("active");

    const duplicate = await core.createAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: created.value.code,
      name: "Other",
      slug: `other-${crypto.randomUUID().slice(0, 12)}`,
      idempotencyKey: `cat-${crypto.randomUUID()}`,
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const invalidUnit = await core.createAdminUnit({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `BAD_${crypto.randomUUID().slice(0, 12)}`,
      displayName: "Bad unit",
      dimension: "LIQUID" as never,
      canonicalBaseCode: "MILLILITER",
      conversionNumerator: 1,
      conversionDenominator: 1,
      idempotencyKey: `unit-${crypto.randomUUID()}`,
    });
    expect(invalidUnit).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const unit = await core.createAdminUnit({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `TSP_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      displayName: "Teaspoon",
      dimension: "VOLUME",
      canonicalBaseCode: "MILLILITER",
      conversionNumerator: 5,
      conversionDenominator: 1,
      idempotencyKey: `unit-${crypto.randomUUID()}`,
    });
    expect(unit.ok).toBe(true);
    if (!unit.ok) return;
    expect(unit.value).toMatchObject({
      dimension: "VOLUME",
      canonicalBaseCode: "MILLILITER",
      conversionNumerator: 5,
      conversionDenominator: 1,
      status: "active",
      version: 1,
    });

    const units = await core.listAdminUnits({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    expect(units.value.some((item) => item.unitId === unit.value.unitId)).toBe(true);
  });

  it("creates SKUs with matching dimensions, sets prices and availability, and audits", async () => {
    const manager = await seedManager();
    const { productId, unitGramId, unitKgId } = await seedProduct();

    // A piece-unit SKU against a MASS pool is rejected.
    const pieceUnitId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO unit (id, code, name, dimension, symbol, created_at) VALUES (?, ?, 'Piece', 'COUNT', 'pc', ?)",
    )
      .bind(pieceUnitId, `PC_${crypto.randomUUID().slice(0, 12)}`, Date.now())
      .run();
    const dimensionMismatch = await core.createAdminSku({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      code: `MISMATCH_${crypto.randomUUID().slice(0, 12)}`,
      name: "1 piece",
      sellableUnitId: pieceUnitId,
      sellQuantity: 1,
      consumptionBaseQuantity: 1,
      idempotencyKey: `sku-${crypto.randomUUID()}`,
    });
    expect(dimensionMismatch).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const conversionMismatch = await core.createAdminSku({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      code: `BAD_CONVERSION_${crypto.randomUUID().slice(0, 12)}`,
      name: "Bad kilogram",
      sellableUnitId: unitKgId,
      sellQuantity: 1,
      consumptionBaseQuantity: 999,
      idempotencyKey: `sku-${crypto.randomUUID()}`,
    });
    expect(conversionMismatch).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });

    const sku = await core.createAdminSku({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      code: `TP_${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
      name: "250 g",
      sellableUnitId: unitGramId,
      sellQuantity: 250,
      consumptionBaseQuantity: 250,
      idempotencyKey: `sku-${crypto.randomUUID()}`,
    });
    expect(sku.ok).toBe(true);
    if (!sku.ok) return;
    expect(sku.value).toMatchObject({ status: "active", version: 1, priceMinor: null });

    // Zero price fails closed.
    const zeroPrice = await core.setAdminSkuPrice({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "PHP",
      amountMinor: 0,
      validFrom: Date.now(),
      expectedVersion: 0,
      idempotencyKey: `price-${crypto.randomUUID()}`,
    });
    expect(zeroPrice).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const wrongCurrency = await core.setAdminSkuPrice({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "USD",
      amountMinor: 2500,
      validFrom: Date.now(),
      expectedVersion: 0,
      idempotencyKey: `price-${crypto.randomUUID()}`,
    });
    expect(wrongCurrency).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });

    const priced = await core.setAdminSkuPrice({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "PHP",
      amountMinor: 2500,
      validFrom: Date.now(),
      expectedVersion: 0,
      idempotencyKey: `price-${crypto.randomUUID()}`,
    });
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    expect(priced.value).toMatchObject({ priceMinor: 2500, currency: "PHP", priceVersion: 1 });

    const successorAt = Date.now() + 1;
    const successorKey = `price-${crypto.randomUUID()}`;
    const successor = await core.setAdminSkuPrice({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "PHP",
      amountMinor: 2600,
      validFrom: successorAt,
      expectedVersion: 1,
      idempotencyKey: successorKey,
    });
    expect(successor).toMatchObject({ ok: true, value: { priceMinor: 2600, priceVersion: 2 } });
    const predecessor = await env.DB.prepare(
      "SELECT valid_to FROM price_version WHERE sku_id=? AND version=1",
    )
      .bind(sku.value.skuId)
      .first<{ valid_to: number | null }>();
    expect(predecessor?.valid_to).toBe(successorAt);

    const racedAt = successorAt + 1;
    const raced = await Promise.all([
      core.setAdminSkuPrice({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        skuId: sku.value.skuId,
        marketId: "market-metro-cebu",
        locationId: null,
        currency: "PHP",
        amountMinor: 2700,
        validFrom: racedAt,
        expectedVersion: 2,
        idempotencyKey: `price-${crypto.randomUUID()}`,
      }),
      core.setAdminSkuPrice({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        skuId: sku.value.skuId,
        marketId: "market-metro-cebu",
        locationId: null,
        currency: "PHP",
        amountMinor: 2800,
        validFrom: racedAt,
        expectedVersion: 2,
        idempotencyKey: `price-${crypto.randomUUID()}`,
      }),
    ]);
    expect(raced.filter((result) => result.ok)).toHaveLength(1);
    expect(raced.filter((result) => !result.ok)).toHaveLength(1);
    const successorReplay = await core.setAdminSkuPrice({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: null,
      currency: "PHP",
      amountMinor: 2600,
      validFrom: successorAt,
      expectedVersion: 1,
      idempotencyKey: successorKey,
    });
    expect(successorReplay.ok).toBe(true);

    const available = await core.setAdminSkuAvailability({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      locationId: "location-cebu-central",
      availabilityStatus: "AVAILABLE",
      sourcingMode: "STOCKED",
      expectedVersion: 0,
      idempotencyKey: `avail-${crypto.randomUUID()}`,
    });
    expect(available.ok).toBe(true);
    if (!available.ok) return;
    expect(available.value.availability).toBe("AVAILABLE");

    const staleAvailability = await core.setAdminSkuAvailability({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      locationId: "location-cebu-central",
      availabilityStatus: "UNAVAILABLE",
      sourcingMode: "STOCKED",
      expectedVersion: 0,
      idempotencyKey: `avail-${crypto.randomUUID()}`,
    });
    expect(staleAvailability).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const updated = await core.updateAdminSku({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      skuId: sku.value.skuId,
      merchandisingLabel: "Pack",
      expectedVersion: 1,
      idempotencyKey: `sku-${crypto.randomUUID()}`,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({ merchandisingLabel: "Pack", version: 2 });

    const auditRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'CATALOG.SKU_PRICE_SET'",
    ).first<{ count: number }>();
    expect(auditRow?.count ?? 0).toBe(3);

    const detail = await core.getAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.skus).toHaveLength(1);
    expect(detail.value.skus[0]).toMatchObject({
      priceVersion: 3,
      availability: "AVAILABLE",
      availabilityVersion: 1,
    });
    expect([2700, 2800]).toContain(detail.value.skus[0]?.priceMinor);
    void unitKgId;
  });

  it("toggles product status with reasons and guards", async () => {
    const manager = await seedManager();
    const { productId } = await seedProduct();

    const sameState = await core.setAdminProductStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      status: "active",
      reason: "already active",
      expectedVersion: 1,
      idempotencyKey: `prod-${crypto.randomUUID()}`,
    });
    expect(sameState).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const statusKey = `prod-${crypto.randomUUID()}`;
    const deactivated = await core.setAdminProductStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      status: "inactive",
      reason: "seasonal pause",
      expectedVersion: 1,
      idempotencyKey: statusKey,
    });
    expect(deactivated.ok).toBe(true);
    if (!deactivated.ok) return;
    expect(deactivated.value).toMatchObject({ status: "inactive", version: 2 });
    const replay = await core.setAdminProductStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      status: "inactive",
      reason: "seasonal pause",
      expectedVersion: 1,
      idempotencyKey: statusKey,
    });
    expect(replay).toMatchObject({ ok: true, value: { status: "inactive", version: 2 } });

    const auditRow = await env.DB.prepare(
      "SELECT reason FROM audit_event WHERE action = 'CATALOG.PRODUCT_STATUS_CHANGED' ORDER BY occurred_at DESC LIMIT 1",
    ).first<{ reason: string | null }>();
    expect(auditRow?.reason).toBe("seasonal pause");
  });
});
