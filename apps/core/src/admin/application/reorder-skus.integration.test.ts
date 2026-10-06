import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { reorderAdminSkus } from "./reorder-skus";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.read','catalog.manage')",
  )
    .bind(manager.id)
    .run();
  const id = crypto.randomUUID();
  const meta = { headers: manager.headers, requestId: id, idempotencyKey: id };
  const category = await exports.default.createAdminCategory({
    ...meta,
    code: `ORDER_${id.replaceAll("-", "").toUpperCase()}`,
    name: "Order category",
    slug: `order-category-${id}`,
  });
  if (!category.ok) throw new Error(category.error.message);
  const product = await exports.default.createAdminProduct({
    ...meta,
    idempotencyKey: `${id}:product`,
    categoryId: category.value.categoryId,
    inventoryBaseUnitId: "unit-gram",
    name: "Order product",
    slug: `order-product-${id}`,
    description: null,
    customerDetails: [],
  });
  if (!product.ok) throw new Error(product.error.message);
  const skus = [];
  for (const grams of [1000, 250, 500]) {
    const result = await exports.default.createAdminSku({
      ...meta,
      idempotencyKey: `${id}:${grams}`,
      productId: product.value.productId,
      code: `ORDER_${id}_${grams}`,
      name: `${grams} g`,
      sellableUnitId: "unit-gram",
      sellQuantity: grams,
      consumptionBaseQuantity: grams,
      sortOrder: 7,
    });
    if (!result.ok) throw new Error(result.error.message);
    skus.push(result.value);
  }
  const request = {
    ...meta,
    idempotencyKey: `${id}:order`,
    productId: product.value.productId,
    expectedProductVersion: product.value.version,
    variants: [skus[1], skus[2], skus[0]].map((sku) => ({
      skuId: sku.skuId,
      expectedVersion: sku.version,
    })),
  };
  return { manager, request, skus };
}
async function rows(productId: string) {
  return (
    await env.DB.prepare(
      "SELECT id,name,status,sort_order,version,consumption_base_quantity FROM sku WHERE product_id=? ORDER BY id",
    )
      .bind(productId)
      .all()
  ).results;
}
async function noReceipt(key: string) {
  expect(
    await env.DB.prepare(
      "SELECT status FROM idempotency_records WHERE scope='admin.catalog.sku.order' AND idempotency_key=?",
    )
      .bind(key)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT id FROM audit_event WHERE action='CATALOG.SKU_ORDER_UPDATED' AND idempotency_key=?",
    )
      .bind(key)
      .first(),
  ).toBeNull();
}
function interceptedBatch(before: (db: D1Database) => Promise<unknown>, loseResponse = false) {
  let first = true;
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (first) {
            first = false;
            await before(target);
          }
          const result = await target.batch(statements);
          if (loseResponse) throw new Error("TEST_LOST_ORDER_RESPONSE");
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Atomic complete SKU ordering", () => {
  it("saves contiguous positions and freezes replay even after later variant changes", async () => {
    const { request, skus } = await fixture();
    const result = await exports.default.reorderAdminSkus(request);
    expect(result).toMatchObject({
      ok: true,
      value: {
        productId: request.productId,
        variants: request.variants.map((sku, sortOrder) => ({
          skuId: sku.skuId,
          sortOrder,
          version: 2,
        })),
      },
    });
    const detail = await exports.default.getAdminProduct({
      headers: request.headers,
      requestId: request.requestId,
      productId: request.productId,
      scopeKind: "GLOBAL",
    });
    expect(detail).toMatchObject({
      ok: true,
      value: { skus: request.variants.map((sku) => ({ skuId: sku.skuId })) },
    });
    expect(
      detail.ok &&
        detail.value.recentAudit.some((audit) => audit.action === "CATALOG.SKU_ORDER_UPDATED"),
    ).toBe(true);
    const storefront = await exports.default.getCatalogProduct({
      requestId: request.requestId,
      slug: `order-product-${request.requestId}`,
    });
    expect(storefront).toMatchObject({
      ok: true,
      value: { product: { variants: request.variants.map((sku) => ({ id: sku.skuId })) } },
    });
    const saved = await rows(request.productId);
    expect(saved).toEqual(
      expect.arrayContaining(
        skus.map((sku) =>
          expect.objectContaining({
            id: sku.skuId,
            name: sku.name,
            status: sku.status,
            consumption_base_quantity: sku.consumptionBaseQuantity,
            version: 2,
          }),
        ),
      ),
    );
    await env.DB.prepare(
      "UPDATE sku SET version=version+1,status='inactive',sort_order=8 WHERE id=?",
    )
      .bind(skus[0].skuId)
      .run();
    expect(await exports.default.reorderAdminSkus(request)).toEqual(result);
    expect(
      await exports.default.reorderAdminSkus({
        ...request,
        variants: [...request.variants].reverse(),
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE idempotency_key=? AND action='CATALOG.SKU_ORDER_UPDATED'",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  for (const kind of ["stale-product", "stale-sku", "incomplete", "foreign", "duplicate"] as const)
    it(`rejects ${kind} without effects`, async () => {
      const { request } = await fixture();
      const before = await rows(request.productId);
      const modified = { ...request, variants: request.variants.map((sku) => ({ ...sku })) };
      if (kind === "stale-product") modified.expectedProductVersion++;
      if (kind === "stale-sku") modified.variants[0].expectedVersion++;
      if (kind === "incomplete") modified.variants.pop();
      if (kind === "foreign") modified.variants[0].skuId = "sku-another-product";
      if (kind === "duplicate") modified.variants[0] = modified.variants[1];
      expect(await exports.default.reorderAdminSkus(modified)).toMatchObject({
        ok: false,
        error: { code: kind === "duplicate" ? "VALIDATION_FAILED" : "STALE_VERSION" },
      });
      expect(await rows(request.productId)).toEqual(before);
      await noReceipt(request.idempotencyKey);
    });
  for (const effect of ["partial-row", "audit", "receipt"] as const)
    it(`rolls back the complete order when ${effect} is suppressed`, async () => {
      const { request, skus } = await fixture();
      const before = await rows(request.productId);
      const trigger =
        effect === "partial-row"
          ? `UPDATE ON sku WHEN OLD.id='${skus[0].skuId}'`
          : effect === "audit"
            ? "INSERT ON audit_event WHEN NEW.action='CATALOG.SKU_ORDER_UPDATED'"
            : "UPDATE ON idempotency_records WHEN NEW.scope='admin.catalog.sku.order' AND NEW.status='SUCCEEDED'";
      await env.DB.exec(
        `CREATE TRIGGER suppress_order_effect BEFORE ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.reorderAdminSkus(request)).toMatchObject({ ok: false });
        expect(await rows(request.productId)).toEqual(before);
        await noReceipt(request.idempotencyKey);
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_order_effect");
      }
    });
  for (const race of ["authority", "version", "membership"] as const)
    it(`rechecks ${race} in the transaction`, async () => {
      const { request, manager, skus } = await fixture();
      const db = interceptedBatch(async (target) => {
        if (race === "authority")
          await target.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
        if (race === "version")
          await target
            .prepare("UPDATE sku SET version=version+1 WHERE id=?")
            .bind(skus[0].skuId)
            .run();
        if (race === "membership")
          await target.prepare("DELETE FROM sku WHERE id=?").bind(skus[0].skuId).run();
      });
      expect(await reorderAdminSkus({ db, auth: createAuth(env) }, request)).toMatchObject({
        ok: false,
      });
      expect((await rows(request.productId)).every((sku) => sku.sort_order === 7)).toBe(true);
      await noReceipt(request.idempotencyKey);
    });
  it("denies local-only and read-only staff and unauthenticated callers", async () => {
    const { request, manager } = await fixture();
    expect(await exports.default.reorderAdminSkus({ ...request, headers: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await env.DB.prepare(
      "UPDATE staff_scope SET scope_kind='location',location_id='location-cebu-central' WHERE staff_id=?",
    )
      .bind(manager.id)
      .run();
    expect(await exports.default.reorderAdminSkus(request)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await env.DB.prepare(
      "UPDATE staff_scope SET scope_kind='global',location_id=NULL WHERE staff_id=?",
    )
      .bind(manager.id)
      .run();
    await env.DB.prepare(
      "DELETE FROM role_permission WHERE role_id=? AND permission_id IN (SELECT id FROM permission WHERE code='catalog.manage')",
    )
      .bind(manager.id)
      .run();
    expect(await exports.default.reorderAdminSkus(request)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await noReceipt(request.idempotencyKey);
  });
  it("recovers lost batch responses and concurrent retries once", async () => {
    const { request } = await fixture();
    const deps = { db: interceptedBatch(async () => {}, true), auth: createAuth(env) };
    const [first, second] = await Promise.all([
      reorderAdminSkus(deps, request),
      reorderAdminSkus(deps, request),
    ]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect((await rows(request.productId)).every((sku) => sku.version === 2)).toBe(true);
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE idempotency_key=? AND action='CATALOG.SKU_ORDER_UPDATED'",
      )
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});
