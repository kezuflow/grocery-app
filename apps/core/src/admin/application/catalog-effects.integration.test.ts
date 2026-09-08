import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { createAdminSku, setAdminSkuAvailability, setAdminSkuPrice } from "./catalog-commands";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('catalog.read','catalog.manage','prices.read','prices.manage')",
  )
    .bind(manager.id)
    .run();
  const id = crypto.randomUUID();
  const meta = { headers: manager.headers, requestId: id, idempotencyKey: id };
  const category = await exports.default.createAdminCategory({
    ...meta,
    code: `EFFECT_${id.replaceAll("-", "").toUpperCase()}`,
    name: "Effect category",
    slug: `effect-category-${id}`,
  });
  if (!category.ok) throw new Error(category.error.message);
  const product = await exports.default.createAdminProduct({
    ...meta,
    idempotencyKey: `${id}:product`,
    categoryId: category.value.categoryId,
    inventoryBaseUnitId: "unit-gram",
    name: "Effect product",
    slug: `effect-product-${id}`,
    description: null,
    customerDetails: [],
  });
  if (!product.ok) throw new Error(product.error.message);
  const skuRequest = {
    ...meta,
    idempotencyKey: `${id}:sku`,
    productId: product.value.productId,
    code: `EFFECT_${id}`,
    name: "250 g",
    sellableUnitId: "unit-gram",
    sellQuantity: 250,
    consumptionBaseQuantity: 250,
  };
  return { manager, meta, skuRequest };
}

describe("Complete catalog command effects", () => {
  for (const command of ["unit", "sku", "update", "availability", "price"] as const)
    for (const effect of ["write", "audit", "receipt"] as const)
      it(`rejects ${command} with no mutation when ${effect} is suppressed`, async () => {
        const { meta, skuRequest } = await fixture();
        const sku = await exports.default.createAdminSku(skuRequest);
        if (!sku.ok) throw new Error(sku.error.message);
        const key = crypto.randomUUID();
        const scopes = {
          unit: "admin.catalog.unit",
          sku: "admin.catalog.sku.create",
          update: "admin.catalog.sku.update",
          availability: "admin.catalog.sku.availability",
          price: "admin.catalog.sku.price",
        };
        const actions = {
          unit: "CATALOG.UNIT_CREATED",
          sku: "CATALOG.SKU_CREATED",
          update: "CATALOG.SKU_UPDATED",
          availability: "CATALOG.SKU_AVAILABILITY_SET",
          price: "CATALOG.SKU_PRICE_SET",
        };
        const unitCode = `U_${key.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
        const writes = {
          unit: "INSERT ON unit",
          sku: "INSERT ON sku",
          update: "UPDATE ON sku",
          availability: "INSERT ON sku_location_availability",
          price: "INSERT ON price_version",
        };
        await env.DB.exec(
          `CREATE TRIGGER suppress_catalog_effect BEFORE ${effect === "write" ? writes[command] : effect === "audit" ? `INSERT ON audit_event WHEN NEW.action='${actions[command]}'` : `UPDATE ON idempotency_records WHEN NEW.scope='${scopes[command]}' AND NEW.status='SUCCEEDED'`} BEGIN SELECT RAISE(IGNORE); END;`,
        );
        try {
          const request = { ...meta, idempotencyKey: key };
          const result =
            command === "unit"
              ? await exports.default.createAdminUnit({
                  ...request,
                  code: unitCode,
                  displayName: "Test unit",
                  dimension: "MASS",
                  canonicalBaseCode: "GRAM",
                  conversionNumerator: 100,
                  conversionDenominator: 1,
                })
              : command === "sku"
                ? await exports.default.createAdminSku({
                    ...skuRequest,
                    ...request,
                    code: key,
                    name: "Different variant",
                  })
                : command === "update"
                  ? await exports.default.updateAdminSku({
                      ...request,
                      skuId: sku.value.skuId,
                      name: "Changed variant",
                      expectedVersion: 1,
                    })
                  : command === "availability"
                    ? await exports.default.setAdminSkuAvailability({
                        ...request,
                        skuId: sku.value.skuId,
                        locationId: "location-cebu-central",
                        availabilityStatus: "AVAILABLE",
                        expectedVersion: 0,
                      })
                    : await exports.default.setAdminSkuPrice({
                        ...request,
                        skuId: sku.value.skuId,
                        marketId: "market-metro-cebu",
                        locationId: "location-cebu-central",
                        currency: "PHP",
                        amountMinor: 1234,
                        validFrom: Date.now(),
                        expectedVersion: 0,
                      });
          expect(result).toMatchObject({ ok: false });
          const count =
            command === "unit"
              ? await env.DB.prepare("SELECT count(*) count FROM unit WHERE code=?")
                  .bind(unitCode)
                  .first()
              : command === "sku"
                ? await env.DB.prepare("SELECT count(*) count FROM sku WHERE code=?")
                    .bind(key.toUpperCase())
                    .first()
                : command === "update"
                  ? await env.DB.prepare("SELECT count(*) count FROM sku WHERE id=? AND version<>1")
                      .bind(sku.value.skuId)
                      .first()
                  : command === "availability"
                    ? await env.DB.prepare(
                        "SELECT count(*) count FROM sku_location_availability WHERE sku_id=?",
                      )
                        .bind(sku.value.skuId)
                        .first()
                    : await env.DB.prepare(
                        "SELECT count(*) count FROM price_version WHERE sku_id=?",
                      )
                        .bind(sku.value.skuId)
                        .first();
          expect(count).toEqual({ count: 0 });
          expect(
            await env.DB.prepare(
              "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
            )
              .bind(key)
              .first(),
          ).toEqual({ count: 0 });
        } finally {
          await env.DB.exec("DROP TRIGGER suppress_catalog_effect");
        }
      });
  it("replays the original SKU and exact-location effects after later changes", async () => {
    const { meta, skuRequest } = await fixture();
    const sku = await exports.default.createAdminSku(skuRequest);
    if (!sku.ok) throw new Error(sku.error.message);
    const availability = {
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      skuId: sku.value.skuId,
      locationId: "location-cebu-central",
      availabilityStatus: "AVAILABLE" as const,
      expectedVersion: 0,
    };
    const enabled = await exports.default.setAdminSkuAvailability(availability);
    const update = {
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      skuId: sku.value.skuId,
      name: "New display",
      expectedVersion: 1,
    };
    expect(await exports.default.updateAdminSku(update)).toMatchObject({ ok: true });
    expect(await exports.default.createAdminSku(skuRequest)).toEqual(sku);
    expect(await exports.default.setAdminSkuAvailability(availability)).toEqual(enabled);
  });
  for (const operation of ["sku", "availability"] as const)
    it(`rechecks scoped authority for ${operation} inside its complete transaction`, async () => {
      const { manager, meta, skuRequest } = await fixture();
      const sku = await exports.default.createAdminSku(skuRequest);
      if (!sku.ok) throw new Error(sku.error.message);
      let changed = false;
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (!changed) {
                changed = true;
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
      const result =
        operation === "sku"
          ? await createAdminSku(
              { db, auth: createAuth(env) },
              {
                ...skuRequest,
                idempotencyKey: crypto.randomUUID(),
                code: crypto.randomUUID(),
                name: "Other variant",
              },
            )
          : await setAdminSkuAvailability(
              { db, auth: createAuth(env) },
              {
                ...meta,
                idempotencyKey: crypto.randomUUID(),
                skuId: sku.value.skuId,
                locationId: "location-cebu-central",
                availabilityStatus: "AVAILABLE",
                expectedVersion: 0,
              },
            );
      expect(changed).toBe(true);
      expect(result).toMatchObject({ ok: false });
    });

  it("recovers a lost batch response and concurrent identical SKU retries without duplicate effects", async () => {
    const { skuRequest } = await fixture();
    let calls = 0;
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            if (++calls === 1) throw new Error("TEST_LOST_BATCH_RESPONSE");
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const deps = { db, auth: createAuth(env) };
    const results = await Promise.all([
      createAdminSku(deps, skuRequest),
      createAdminSku(deps, skuRequest),
    ]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toEqual(results[0]);
    expect(
      await env.DB.prepare("SELECT count(*) count FROM sku WHERE code=?")
        .bind(skuRequest.code.toUpperCase())
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT count(*) count FROM audit_event WHERE idempotency_key=? AND action='CATALOG.SKU_CREATED'",
      )
        .bind(skuRequest.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
    expect(await createAdminSku(deps, { ...skuRequest, name: "Different intent" })).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
  });

  it("rejects a newly inactive sell unit at the write boundary with no SKU or receipt", async () => {
    const { skuRequest } = await fixture();
    const unitId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO unit(id,code,name,dimension,symbol,canonical_base_code,conversion_numerator,conversion_denominator,status,version,created_at,updated_at) VALUES (?,?,'Gram equivalent','MASS','g','GRAM',1,1,'active',1,1,1)",
    )
      .bind(unitId, `TEST_${unitId}`)
      .run();
    const request = { ...skuRequest, sellableUnitId: unitId };
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.prepare("UPDATE unit SET status='inactive' WHERE id=?").bind(unitId).run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await createAdminSku({ db, auth: createAuth(env) }, request)).toMatchObject({
      ok: false,
    });
    expect(
      await env.DB.prepare("SELECT id FROM sku WHERE code=?")
        .bind(request.code.toUpperCase())
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toBeNull();
  });

  it("freezes each exact-location price receipt while simultaneous location writes get distinct versions", async () => {
    const { meta, skuRequest } = await fixture();
    const sku = await exports.default.createAdminSku(skuRequest);
    if (!sku.ok) throw new Error(sku.error.message);
    const locationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO fulfillment_location(id,market_id,code,name,type,status,latitude,longitude,created_at,updated_at) SELECT ?,market_id,?,'Second site',type,'active',latitude,longitude,created_at,updated_at FROM fulfillment_location WHERE id='location-cebu-central'",
    )
      .bind(locationId, `SITE_${locationId}`)
      .run();
    const request = {
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      skuId: sku.value.skuId,
      marketId: "market-metro-cebu",
      locationId: "location-cebu-central",
      currency: "PHP",
      amountMinor: 1234,
      validFrom: Date.now(),
      expectedVersion: 0,
    };
    const other = {
      ...request,
      locationId,
      amountMinor: 2345,
      idempotencyKey: crypto.randomUUID(),
    };
    const deps = { db: env.DB, auth: createAuth(env) };
    const [first, second] = await Promise.all([
      setAdminSkuPrice(deps, request),
      setAdminSkuPrice(deps, other),
    ]);
    expect(first).toMatchObject({ ok: true, value: { priceMinor: 1234 } });
    expect(second).toMatchObject({ ok: true, value: { priceMinor: 2345 } });
    if (!first.ok || !second.ok) throw new Error("Prices did not apply");
    expect(first.value.priceVersion).not.toBe(second.value.priceVersion);
    expect(
      await setAdminSkuPrice(deps, {
        ...request,
        amountMinor: 3456,
        validFrom: request.validFrom + 1,
        expectedVersion: first.value.priceVersion ?? 0,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await setAdminSkuPrice(deps, request)).toEqual(first);
    expect(await setAdminSkuPrice(deps, other)).toEqual(second);
  });
});
