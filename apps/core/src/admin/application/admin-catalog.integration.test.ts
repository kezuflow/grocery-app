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
  categoryId: string;
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
  return { categoryId, productId, poolId, unitGramId, unitKgId };
}

describe("catalog administration", () => {
  it("creates and updates a Product with ordered customer details and guarded replay", async () => {
    const manager = await seedManager();
    const seeded = await seedProduct();
    const createKey = `product-${crypto.randomUUID()}`;
    const created = await core.createAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: seeded.categoryId,
      slug: `authored-${crypto.randomUUID().slice(0, 12)}`,
      name: "Authored Product",
      description: "Customer description",
      customerDetails: [
        { label: "Storage", value: "Keep refrigerated.", sortOrder: 2 },
        { label: "Contents", value: "One product.", sortOrder: 1 },
      ],
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: createKey,
    });
    expect(created, JSON.stringify(created)).toMatchObject({
      ok: true,
      value: { name: "Authored Product", version: 1 },
    });
    if (!created.ok) return;
    const replay = await core.createAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Authored Product",
      description: "Customer description",
      customerDetails: [
        { label: "Storage", value: "Keep refrigerated.", sortOrder: 2 },
        { label: "Contents", value: "One product.", sortOrder: 1 },
      ],
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: createKey,
    });
    expect(replay).toMatchObject({ ok: true, value: { productId: created.value.productId } });
    await env.DB.prepare("UPDATE category SET status='inactive' WHERE id=?")
      .bind(seeded.categoryId)
      .run();
    const replayAfterCategoryChange = await core.createAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Authored Product",
      description: "Customer description",
      customerDetails: [
        { label: "Storage", value: "Keep refrigerated.", sortOrder: 2 },
        { label: "Contents", value: "One product.", sortOrder: 1 },
      ],
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: createKey,
    });
    expect(replayAfterCategoryChange).toMatchObject({
      ok: true,
      value: { productId: created.value.productId },
    });
    await env.DB.prepare("UPDATE category SET status='active' WHERE id=?")
      .bind(seeded.categoryId)
      .run();
    const changedReplay = await core.createAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Changed replay",
      description: "Customer description",
      customerDetails: [],
      inventoryBaseUnitId: "unit-gram",
      idempotencyKey: createKey,
    });
    expect(changedReplay).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const detail = await core.getAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId: created.value.productId,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: {
        categoryId: seeded.categoryId,
        customerDetails: [{ label: "Contents" }, { label: "Storage" }],
        inventoryPool: { baseUnitId: "unit-gram" },
        allowedActions: ["UPDATE", "SET_STATUS"],
      },
    });

    const staleKey = `product-${crypto.randomUUID()}`;
    const stale = await core.updateAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId: created.value.productId,
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Stale Product",
      description: null,
      customerDetails: [],
      expectedVersion: 99,
      idempotencyKey: staleKey,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
    const staleWrites = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='CATALOG.PRODUCT_UPDATED' AND idempotency_key=?",
    )
      .bind(staleKey)
      .first<{ count: number }>();
    expect(staleWrites?.count).toBe(0);

    const updateKey = `product-${crypto.randomUUID()}`;
    const updated = await core.updateAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId: created.value.productId,
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Updated Product",
      description: null,
      customerDetails: [{ label: "Contents", value: "Updated contents.", sortOrder: 1 }],
      expectedVersion: 1,
      idempotencyKey: updateKey,
    });
    expect(updated).toMatchObject({ ok: true, value: { name: "Updated Product", version: 2 } });
    const updatedReplay = await core.updateAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId: created.value.productId,
      categoryId: seeded.categoryId,
      slug: created.value.slug,
      name: "Updated Product",
      description: null,
      customerDetails: [{ label: "Contents", value: "Updated contents.", sortOrder: 1 }],
      expectedVersion: 1,
      idempotencyKey: updateKey,
    });
    expect(updatedReplay).toMatchObject({ ok: true, value: { version: 2 } });

    const locationOnly = await seedManager({ scope: "location" });
    expect(
      await core.createAdminProduct({
        requestId: crypto.randomUUID(),
        headers: { cookie: locationOnly.cookie },
        categoryId: seeded.categoryId,
        slug: `denied-${crypto.randomUUID().slice(0, 12)}`,
        name: "Denied Product",
        description: null,
        customerDetails: [],
        inventoryBaseUnitId: "unit-gram",
        idempotencyKey: `product-${crypto.randomUUID()}`,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("creates, reads, updates, and deactivates a hierarchy with guarded versions", async () => {
    const manager = await seedManager();
    const parent = await core.createAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `PARENT_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      name: "Parent category",
      slug: `parent-${crypto.randomUUID().slice(0, 12)}`,
      parentCategoryId: null,
      iconAssetKey: "fruits.svg",
      sortOrder: 10,
      idempotencyKey: `category-${crypto.randomUUID()}`,
    });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    expect(parent.value).toMatchObject({ version: 1, parentCategoryId: null });

    const child = await core.createAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      code: `CHILD_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      name: "Child category",
      slug: `child-${crypto.randomUUID().slice(0, 12)}`,
      parentCategoryId: parent.value.categoryId,
      iconAssetKey: null,
      sortOrder: 11,
      idempotencyKey: `category-${crypto.randomUUID()}`,
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    const detail = await core.getAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: parent.value.categoryId,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: {
        children: [{ categoryId: child.value.categoryId }],
        allowedActions: ["UPDATE", "SET_STATUS"],
      },
    });

    const selfParent = await core.updateAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: child.value.categoryId,
      name: child.value.name,
      slug: child.value.slug,
      parentCategoryId: child.value.categoryId,
      iconAssetKey: null,
      sortOrder: child.value.sortOrder,
      expectedVersion: 1,
      idempotencyKey: `category-${crypto.randomUUID()}`,
    });
    expect(selfParent).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const cycle = await core.updateAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: parent.value.categoryId,
      name: parent.value.name,
      slug: parent.value.slug,
      parentCategoryId: child.value.categoryId,
      iconAssetKey: "fruits.svg",
      sortOrder: parent.value.sortOrder,
      expectedVersion: 1,
      idempotencyKey: `category-${crypto.randomUUID()}`,
    });
    expect(cycle).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const updatedKey = `category-${crypto.randomUUID()}`;
    const updated = await core.updateAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: child.value.categoryId,
      name: "Updated child",
      slug: child.value.slug,
      parentCategoryId: parent.value.categoryId,
      iconAssetKey: "vegetables.svg",
      sortOrder: 12,
      expectedVersion: 1,
      idempotencyKey: updatedKey,
    });
    expect(updated).toMatchObject({ ok: true, value: { name: "Updated child", version: 2 } });
    const changedReplay = await core.updateAdminCategory({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: child.value.categoryId,
      name: "Different replay",
      slug: child.value.slug,
      parentCategoryId: parent.value.categoryId,
      iconAssetKey: "vegetables.svg",
      sortOrder: 12,
      expectedVersion: 1,
      idempotencyKey: updatedKey,
    });
    expect(changedReplay).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });

    const deactivated = await core.setAdminCategoryStatus({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      categoryId: child.value.categoryId,
      status: "inactive",
      reason: "Seasonal catalog pause",
      expectedVersion: 2,
      idempotencyKey: `category-${crypto.randomUUID()}`,
    });
    expect(deactivated).toMatchObject({ ok: true, value: { status: "inactive", version: 3 } });
    const audit = await env.DB.prepare(
      "SELECT reason FROM audit_event WHERE action='CATALOG.CATEGORY_STATUS_CHANGED' AND aggregate_id=?",
    )
      .bind(child.value.categoryId)
      .first<{ reason: string | null }>();
    expect(audit?.reason).toBe("Seasonal catalog pause");
  });
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
    const customerId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const snapshotName = "Historical Product Snapshot";
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, crypto.randomUUID(), now, now),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 100, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
      ).bind(paymentId, customerId, crypto.randomUUID(), now, now),
      env.DB.prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, 'cycle-next-cebu', '{}', 'COMMITTED', 100, 'PHP', ?, ?, 1)",
      ).bind(orderId, customerId, paymentId, now),
      env.DB.prepare(
        "INSERT INTO order_item (id, order_id, sku_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor, base_quantity) VALUES (?, ?, ?, ?, 'Historical variant', 'g', 1, 100, 100, 1)",
      ).bind(crypto.randomUUID(), orderId, `historical-${productId}`, snapshotName),
    ]);

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
    const historical = await env.DB.prepare(
      "SELECT product_name_snapshot AS productName FROM order_item WHERE order_id=?",
    )
      .bind(orderId)
      .first<{ productName: string }>();
    expect(historical?.productName).toBe(snapshotName);
    expect(
      await core.getAdminProduct({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        productId,
      }),
    ).toMatchObject({ ok: true, value: { status: "inactive" } });
  });
});

describe("Product media administration", () => {
  const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer;
  const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer;

  it("exposes the local Product media R2 binding and rejects invalid image payloads", async () => {
    const bucket = (env as unknown as { PRODUCT_MEDIA?: R2Bucket }).PRODUCT_MEDIA;
    expect(bucket).toBeDefined();
    const manager = await seedManager();
    const { productId } = await seedProduct();

    const invalidSignature = await core.uploadAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      mimeType: "image/jpeg",
      altText: "Invalid image",
      isPrimary: false,
      sortOrder: 0,
      expectedProductVersion: 1,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(invalidSignature).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });

    const oversized = await core.uploadAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      bytes: new Uint8Array(5 * 1024 * 1024 + 1).buffer,
      mimeType: "image/png",
      altText: "Too large",
      isPrimary: false,
      sortOrder: 0,
      expectedProductVersion: 1,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(oversized).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("uploads generated R2 keys idempotently, orders media, and records Audit", async () => {
    const bucket = (env as unknown as { PRODUCT_MEDIA: R2Bucket }).PRODUCT_MEDIA;
    const manager = await seedManager();
    const { productId } = await seedProduct();
    const idempotencyKey = `media-${crypto.randomUUID()}`;
    const firstRequest = {
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      bytes: jpeg(),
      mimeType: "image/jpeg" as const,
      altText: "Primary product photograph",
      isPrimary: true,
      sortOrder: 2,
      expectedProductVersion: 1,
      idempotencyKey,
    };
    const uploaded = await core.uploadAdminProductMedia(firstRequest);
    expect(uploaded).toMatchObject({
      ok: true,
      value: { altText: "Primary product photograph", isPrimary: true, version: 1 },
    });
    if (!uploaded.ok) return;
    const metadata = await env.DB.prepare(
      "SELECT object_key AS objectKey, byte_size AS byteSize FROM product_media WHERE id=?",
    )
      .bind(uploaded.value.mediaId)
      .first<{ objectKey: string; byteSize: number }>();
    expect(metadata).toEqual({
      objectKey: `products/${productId}/${uploaded.value.mediaId}`,
      byteSize: 6,
    });
    expect(await bucket.head(metadata!.objectKey)).not.toBeNull();

    const replay = await core.uploadAdminProductMedia({
      ...firstRequest,
      requestId: crypto.randomUUID(),
      bytes: jpeg(),
    });
    expect(replay).toMatchObject({ ok: true, value: { mediaId: uploaded.value.mediaId } });
    const changedReplay = await core.uploadAdminProductMedia({
      ...firstRequest,
      requestId: crypto.randomUUID(),
      bytes: png(),
      mimeType: "image/png",
    });
    expect(changedReplay).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_event WHERE action='CATALOG.PRODUCT_MEDIA_UPLOADED' AND aggregate_id=?",
    )
      .bind(uploaded.value.mediaId)
      .first<{ count: number }>();
    expect(audit?.count).toBe(1);
    await env.DB.prepare("DELETE FROM product_media WHERE id=?").bind(uploaded.value.mediaId).run();
    const missingMetadataReplay = await core.uploadAdminProductMedia({
      ...firstRequest,
      requestId: crypto.randomUUID(),
      bytes: jpeg(),
    });
    expect(missingMetadataReplay).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await bucket.head(metadata!.objectKey)).toBeNull();
  });

  it("deletes a just-uploaded object when authoritative D1 attachment fails", async () => {
    const bucket = (env as unknown as { PRODUCT_MEDIA: R2Bucket }).PRODUCT_MEDIA;
    const manager = await seedManager();
    const { productId } = await seedProduct();
    const triggerName = `reject_media_${crypto.randomUUID().replaceAll("-", "")}`;
    await env.DB.prepare(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON product_media
       WHEN NEW.product_id='${productId}' BEGIN SELECT RAISE(ABORT, 'forced attachment failure'); END`,
    ).run();
    try {
      const result = await core.uploadAdminProductMedia({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        productId,
        bytes: jpeg(),
        mimeType: "image/jpeg",
        altText: "Cleanup test",
        isPrimary: false,
        sortOrder: 0,
        expectedProductVersion: 1,
        idempotencyKey: `media-${crypto.randomUUID()}`,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      const objects = await bucket.list({ prefix: `products/${productId}/` });
      expect(objects.objects).toHaveLength(0);
      const metadata = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM product_media WHERE product_id=?",
      )
        .bind(productId)
        .first<{ count: number }>();
      expect(metadata?.count).toBe(0);
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${triggerName}`).run();
    }
  });

  it("enforces Product versions and one primary while updating and removing media", async () => {
    const bucket = (env as unknown as { PRODUCT_MEDIA: R2Bucket }).PRODUCT_MEDIA;
    const manager = await seedManager();
    const { productId } = await seedProduct();
    const upload = async (
      altText: string,
      isPrimary: boolean,
      sortOrder: number,
      expectedProductVersion: number,
    ) =>
      core.uploadAdminProductMedia({
        requestId: crypto.randomUUID(),
        headers: { cookie: manager.cookie },
        productId,
        bytes: jpeg(),
        mimeType: "image/jpeg",
        altText,
        isPrimary,
        sortOrder,
        expectedProductVersion,
        idempotencyKey: `media-${crypto.randomUUID()}`,
      });
    const first = await upload("First", true, 3, 1);
    const second = await upload("Second", true, 1, 2);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const primaries = await env.DB.prepare(
      "SELECT id FROM product_media WHERE product_id=? AND status='active' AND is_primary=1",
    )
      .bind(productId)
      .all<{ id: string }>();
    expect(primaries.results.map((row) => row.id)).toEqual([second.value.mediaId]);

    const stale = await core.updateAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      mediaId: first.value.mediaId,
      altText: "Stale",
      isPrimary: false,
      sortOrder: 9,
      expectedProductVersion: 2,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });

    const updated = await core.updateAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      mediaId: first.value.mediaId,
      altText: "First reordered",
      isPrimary: true,
      sortOrder: 0,
      expectedProductVersion: 3,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { altText: "First reordered", isPrimary: true, sortOrder: 0, version: 3 },
    });
    const detail = await core.getAdminProduct({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
    });
    expect(detail).toMatchObject({
      ok: true,
      value: {
        version: 4,
        media: [
          { mediaId: first.value.mediaId, isPrimary: true },
          { mediaId: second.value.mediaId, isPrimary: false },
        ],
      },
    });
    const objectKey = `products/${productId}/${first.value.mediaId}`;
    await bucket.delete(objectKey);
    expect(await bucket.head(objectKey)).toBeNull();
    const removed = await core.removeAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: manager.cookie },
      productId,
      mediaId: first.value.mediaId,
      expectedProductVersion: 4,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(removed).toMatchObject({ ok: true, value: { status: "inactive", version: 4 } });
    expect(await bucket.head(objectKey)).toBeNull();
  });

  it("denies media mutation without global catalog management", async () => {
    const locationStaff = await seedManager({ scope: "location" });
    const { productId } = await seedProduct();
    const denied = await core.uploadAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: { cookie: locationStaff.cookie },
      productId,
      bytes: jpeg(),
      mimeType: "image/jpeg",
      altText: "Denied",
      isPrimary: false,
      sortOrder: 0,
      expectedProductVersion: 1,
      idempotencyKey: `media-${crypto.randomUUID()}`,
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
