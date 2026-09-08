import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { createAdminProduct } from "./catalog-commands";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.read','catalog.manage')",
  )
    .bind(manager.id)
    .run();
  const id = crypto.randomUUID();
  const category = await exports.default.createAdminCategory({
    headers: manager.headers,
    requestId: id,
    idempotencyKey: id,
    code: `PRODUCT_${id.replaceAll("-", "").toUpperCase()}`,
    name: "Product test category",
    slug: `product-category-${id}`,
  });
  if (!category.ok) throw new Error(category.error.message);
  const baseUnit = await env.DB.prepare("SELECT id FROM unit WHERE code='GRAM'").first<string>(
    "id",
  );
  if (!baseUnit) throw new Error("Missing gram base unit");
  return {
    manager,
    request: {
      headers: manager.headers,
      requestId: id,
      idempotencyKey: crypto.randomUUID(),
      categoryId: category.value.categoryId,
      inventoryBaseUnitId: baseUnit,
      name: "Fresh audited product",
      slug: `product-${id}`,
      description: null,
      customerDetails: [
        { label: "Origin", value: "Cebu", sortOrder: 0 },
        { label: "Storage", value: "Keep cool", sortOrder: 1 },
      ],
    },
  };
}
async function orphanCount() {
  return env.DB.prepare(
    "SELECT count(*) count FROM inventory_pool pool WHERE NOT EXISTS (SELECT 1 FROM product p WHERE p.inventory_pool_id=pool.id)",
  ).first();
}
describe("Product command recovery", () => {
  for (const [label, trigger] of [
    ["pool", "BEFORE INSERT ON inventory_pool"],
    ["product", "BEFORE INSERT ON product"],
    ["detail", "BEFORE INSERT ON product_detail WHEN NEW.label='Storage'"],
    ["audit", "BEFORE INSERT ON audit_event WHEN NEW.action='CATALOG.PRODUCT_CREATED'"],
    [
      "receipt",
      "BEFORE UPDATE ON idempotency_records WHEN NEW.scope='admin.catalog.product.create' AND NEW.status='SUCCEEDED'",
    ],
  ])
    it(`rejects a suppressed ${label} with no partial Product or pool`, async () => {
      const { request } = await fixture();
      const orphans = await orphanCount();
      await env.DB.exec(
        `CREATE TRIGGER suppress_product_effect ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.createAdminProduct(request)).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT count(*) count FROM product WHERE slug=?")
            .bind(request.slug)
            .first(),
        ).toEqual({ count: 0 });
        expect(await orphanCount()).toEqual(orphans);
        expect(
          await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
            .bind(request.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) count FROM idempotency_records WHERE scope='admin.catalog.product.create' AND idempotency_key=? AND status='SUCCEEDED'",
          )
            .bind(request.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_product_effect");
      }
      expect(await exports.default.createAdminProduct(request)).toMatchObject({ ok: true });
    });
  for (const change of ["category", "scope"] as const)
    it(`rechecks ${change} immediately before all Product effects`, async () => {
      const { manager, request } = await fixture();
      const orphans = await orphanCount();
      let changed = false;
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (!changed) {
                changed = true;
                if (change === "category")
                  await target
                    .prepare("UPDATE category SET status='inactive',version=version+1 WHERE id=?")
                    .bind(request.categoryId)
                    .run();
                else
                  await target
                    .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                    .bind(manager.id)
                    .run();
              }
              return target.batch(statements);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await createAdminProduct({ db, auth: createAuth(env) }, request)).toMatchObject({
        ok: false,
      });
      expect(changed).toBe(true);
      expect(
        await env.DB.prepare("SELECT count(*) count FROM product WHERE slug=?")
          .bind(request.slug)
          .first(),
      ).toEqual({ count: 0 });
      expect(await orphanCount()).toEqual(orphans);
    });
  it("replays original Product results after metadata and lifecycle changes", async () => {
    const { request } = await fixture();
    const created = await exports.default.createAdminProduct(request);
    if (!created.ok) throw new Error(created.error.message);
    const edit = {
      ...request,
      productId: created.value.productId,
      expectedVersion: 1,
      name: "Changed product",
      customerDetails: [],
      idempotencyKey: crypto.randomUUID(),
    };
    const edited = await exports.default.updateAdminProduct(edit);
    expect(edited).toMatchObject({ ok: true, value: { version: 2 } });
    const status = {
      ...request,
      productId: created.value.productId,
      status: "inactive" as const,
      expectedVersion: 2,
      reason: "Product review",
      idempotencyKey: crypto.randomUUID(),
    };
    const deactivated = await exports.default.setAdminProductStatus(status);
    expect(deactivated).toMatchObject({ ok: true, value: { version: 3 } });
    expect(await exports.default.createAdminProduct(request)).toEqual(created);
    expect(await exports.default.updateAdminProduct(edit)).toEqual(edited);
    expect(await exports.default.setAdminProductStatus(status)).toEqual(deactivated);
    expect(
      await exports.default.updateAdminProduct({ ...edit, name: "Changed replay payload" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  for (const effect of ["details", "status audit"] as const)
    it(`rolls back the Product when its ${effect} effect is suppressed`, async () => {
      const { request } = await fixture();
      const created = await exports.default.createAdminProduct(request);
      if (!created.ok) throw new Error(created.error.message);
      const key = crypto.randomUUID();
      await env.DB.exec(
        `CREATE TRIGGER suppress_product_change ${effect === "details" ? "BEFORE DELETE ON product_detail WHEN OLD.label='Storage'" : "BEFORE INSERT ON audit_event WHEN NEW.action='CATALOG.PRODUCT_STATUS_CHANGED'"} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        const command = {
          ...request,
          productId: created.value.productId,
          expectedVersion: 1,
          idempotencyKey: key,
        };
        const result =
          effect === "details"
            ? await exports.default.updateAdminProduct({
                ...command,
                name: "Must roll back",
                customerDetails: [],
              })
            : await exports.default.setAdminProductStatus({
                ...command,
                status: "inactive",
                reason: "Check required audit",
              });
        expect(result).toMatchObject({ ok: false });
        expect(
          await env.DB.prepare("SELECT name,status,version FROM product WHERE id=?")
            .bind(created.value.productId)
            .first(),
        ).toEqual({ name: request.name, status: "active", version: 1 });
        expect(
          await env.DB.prepare("SELECT count(*) count FROM product_detail WHERE product_id=?")
            .bind(created.value.productId)
            .first(),
        ).toEqual({ count: 2 });
        expect(
          await env.DB.prepare(
            "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
          )
            .bind(key)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER suppress_product_change");
      }
    });
  it("permits only one competing Product edit at the same version", async () => {
    const { request } = await fixture();
    const created = await exports.default.createAdminProduct(request);
    if (!created.ok) throw new Error(created.error.message);
    const results = await Promise.all(
      ["First", "Second"].map((name) =>
        exports.default.updateAdminProduct({
          ...request,
          name,
          productId: created.value.productId,
          expectedVersion: 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT version FROM product WHERE id=?")
        .bind(created.value.productId)
        .first(),
    ).toEqual({ version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE aggregate_id=? AND action='CATALOG.PRODUCT_UPDATED'",
      )
        .bind(created.value.productId)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("recovers a committed Product creation after its batch response is lost", async () => {
    const { request } = await fixture();
    let lost = false;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (!lost) {
              lost = true;
              throw new Error("Lost batch response");
            }
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const created = await createAdminProduct({ db, auth: createAuth(env) }, request);
    expect(created).toMatchObject({ ok: true });
    expect(await exports.default.createAdminProduct(request)).toEqual(created);
  });
});
