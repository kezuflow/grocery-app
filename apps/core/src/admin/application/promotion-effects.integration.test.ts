import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { createAuth } from "../../auth/service";
import {
  createAdminPromotion,
  updateAdminPromotion,
  grantAdminPromotion,
} from "./promotion-commands";
import { locationManager } from "../../test-location-fixtures";
import { setAdminPromotionAudience } from "./promotion-audience";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.read','promotions.manage')",
  )
    .bind(manager.id)
    .run();
  const id = crypto.randomUUID();
  const meta = { headers: manager.headers, requestId: id, idempotencyKey: id };
  const create = {
    ...meta,
    code: `PROMO_${id.replaceAll("-", "").toUpperCase()}`,
    name: "Campaign",
    description: "Campaign description",
    benefitType: "ORDER_FIXED_DISCOUNT" as const,
    discountMinor: 500,
    minimumMinor: 0,
    startsAt: new Date(Date.now() - 1000).toISOString(),
  };
  return { manager, meta, create };
}
for (const command of ["definition", "audience"] as const)
  for (const change of ["activation", "sale-target"] as const)
    it(`rejects an inactive ${command} edit raced by ${change} without a success effect`, async () => {
      const { meta, create } = await fixture();
      const initial = await exports.default.createAdminPromotion(create);
      if (!initial.ok) throw new Error(initial.error.message);
      const promotionId = initial.value.promotionId;
      await env.DB.prepare("UPDATE promotion SET status='INACTIVE' WHERE id=?")
        .bind(promotionId)
        .run();
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              if (change === "activation")
                await env.DB.prepare("UPDATE promotion SET status='ACTIVE' WHERE id=?")
                  .bind(promotionId)
                  .run();
              else
                await env.DB.prepare(
                  "INSERT INTO promotion_product_target(promotion_id,sku_id,location_id,quantity_limit,remaining_quantity) VALUES (?,'sku-abiu-1pc','location-cebu-central',NULL,NULL)",
                )
                  .bind(promotionId)
                  .run();
              return target.batch(statements);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const key = crypto.randomUUID();
      const deps = { db, auth: createAuth(env) };
      const request = { ...meta, promotionId, expectedVersion: 1, idempotencyKey: key };
      const result =
        command === "definition"
          ? await updateAdminPromotion(deps, { ...create, ...request, name: "Raced edit" })
          : await setAdminPromotionAudience(deps, {
              ...request,
              rules: [{ type: "FIRST_ORDER", parameters: {} }],
            });
      expect(result).toMatchObject({ ok: false });
      expect(
        await env.DB.prepare("SELECT name,version FROM promotion WHERE id=?")
          .bind(promotionId)
          .first(),
      ).toEqual({ name: "Campaign", version: 1 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM promotion_rule WHERE promotion_id=?")
          .bind(promotionId)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
          .bind(key)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
        )
          .bind(key)
          .first(),
      ).toEqual({ count: 0 });
    });

it("keeps inactive product-sale definitions and audiences locked", async () => {
  const { meta, create } = await fixture();
  const initial = await exports.default.createAdminPromotion({
    ...create,
    productTargets: [
      { skuId: "sku-abiu-1pc", locationId: "location-cebu-central", quantityLimit: null },
    ],
    automatic: true,
  });
  if (!initial.ok) throw new Error(initial.error.message);
  const promotionId = initial.value.promotionId;
  await env.DB.prepare("UPDATE promotion SET status='INACTIVE' WHERE id=?").bind(promotionId).run();
  expect(
    await exports.default.updateAdminPromotion({
      ...create,
      promotionId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      productTargets: [],
    }),
  ).toMatchObject({ ok: false });
  expect(
    await exports.default.setAdminPromotionAudience({
      ...meta,
      promotionId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      rules: [],
    }),
  ).toMatchObject({ ok: false });
  expect(
    await env.DB.prepare("SELECT COUNT(*) count FROM promotion_product_target WHERE promotion_id=?")
      .bind(promotionId)
      .first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare("SELECT version,status FROM promotion WHERE id=?")
      .bind(promotionId)
      .first(),
  ).toEqual({ version: 1, status: "INACTIVE" });
});

describe("Promotion command transaction effects", () => {
  for (const command of ["create", "update", "status", "grant"] as const)
    for (const effect of ["write", "audit", "receipt"] as const)
      for (const editableStatus of command === "update" ? ["DRAFT", "INACTIVE"] : ["DRAFT"])
        it(`rolls back ${command} from ${editableStatus} when ${effect} is suppressed`, async () => {
          const { manager, meta, create } = await fixture();
          const initial = await exports.default.createAdminPromotion(create);
          if (!initial.ok) throw new Error(initial.error.message);
          const promotionId = initial.value.promotionId;
          // Exercise the newly editable inactive state at the same required-effect boundary.
          if (command === "update" && editableStatus === "INACTIVE")
            await env.DB.prepare("UPDATE promotion SET status='INACTIVE' WHERE id=?")
              .bind(promotionId)
              .run();
          const customerId = crypto.randomUUID();
          if (command === "grant") {
            const activated = await exports.default.changeAdminPromotionStatus({
              ...meta,
              idempotencyKey: crypto.randomUUID(),
              promotionId,
              action: "ACTIVATE",
              reason: "Launch",
              expectedVersion: 1,
            });
            if (!activated.ok) throw new Error(activated.error.message);
            await env.DB.prepare(
              "INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) SELECT ?,auth_user_id,id,'active',1,?,? FROM customer_principal WHERE auth_user_id=(SELECT auth_user_id FROM staff_identity WHERE id=?)",
            )
              .bind(customerId, Date.now(), Date.now(), manager.id)
              .run();
          }
          const actions = {
            create: "CREATED",
            update: "UPDATED",
            status: "ACTIVATED",
            grant: "GRANTED",
          };
          const write =
            command === "create"
              ? "INSERT ON promotion"
              : command === "grant"
                ? "INSERT ON promotion_grant"
                : "UPDATE ON promotion";
          await env.DB.exec(
            `CREATE TRIGGER suppress_promotion_effect BEFORE ${effect === "write" ? write : effect === "audit" ? `INSERT ON audit_event WHEN NEW.action='PROMOTION.${actions[command]}'` : `UPDATE ON idempotency_records WHEN NEW.scope='admin.promotions.${command}' AND NEW.status='SUCCEEDED'`} BEGIN SELECT RAISE(IGNORE); END;`,
          );
          const key = crypto.randomUUID();
          let outcome: unknown;
          try {
            const request = { ...meta, idempotencyKey: key, promotionId };
            outcome =
              command === "create"
                ? await exports.default.createAdminPromotion({
                    ...create,
                    ...request,
                    code: `OTHER_${key.replaceAll("-", "").toUpperCase()}`,
                  })
                : command === "update"
                  ? await exports.default.updateAdminPromotion({
                      ...create,
                      ...request,
                      name: "Changed",
                      expectedVersion: 1,
                    })
                  : command === "status"
                    ? await exports.default.changeAdminPromotionStatus({
                        ...request,
                        action: "ACTIVATE",
                        reason: "Launch",
                        expectedVersion: 1,
                      })
                    : await exports.default.grantAdminPromotion({
                        ...request,
                        customerId,
                        maxRedemptions: 1,
                      });
          } catch {
            outcome = { ok: false };
          } finally {
            await env.DB.exec("DROP TRIGGER suppress_promotion_effect");
          }
          expect(
            await env.DB.prepare("SELECT name,status,version FROM promotion WHERE id=?")
              .bind(promotionId)
              .first(),
          ).toEqual({
            name: "Campaign",
            status: command === "grant" ? "ACTIVE" : editableStatus,
            version: command === "grant" ? 2 : 1,
          });
          expect(
            await env.DB.prepare("SELECT count(*) count FROM promotion WHERE code=?")
              .bind(`OTHER_${key.replaceAll("-", "").toUpperCase()}`)
              .first(),
          ).toEqual({ count: 0 });
          expect(
            await env.DB.prepare("SELECT count(*) count FROM promotion_grant WHERE customer_id=?")
              .bind(customerId)
              .first(),
          ).toEqual({ count: 0 });
          expect(
            await env.DB.prepare(
              "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=? AND status='SUCCEEDED'",
            )
              .bind(key)
              .first(),
          ).toEqual({ count: 0 });
          expect(outcome).toMatchObject({ ok: false });
        });
  it("replays a lifecycle command before rejecting its now-applied state", async () => {
    const { meta, create } = await fixture();
    const initial = await exports.default.createAdminPromotion(create);
    if (!initial.ok) throw new Error(initial.error.message);
    const activate = {
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      promotionId: initial.value.promotionId,
      action: "ACTIVATE" as const,
      reason: "Launch",
      expectedVersion: 1,
    };
    const active = await exports.default.changeAdminPromotionStatus(activate);
    expect(active).toMatchObject({ ok: true, value: { status: "ACTIVE", version: 2 } });
    expect(await exports.default.changeAdminPromotionStatus(activate)).toEqual(active);
    expect(await exports.default.createAdminPromotion(create)).toEqual(initial);
  });
});

function interceptBatch(before: () => Promise<void>, loseResponse = false) {
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await before();
          const result = await target.batch(statements);
          if (loseResponse) throw new Error("TEST_LOST_RESPONSE");
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
it("rechecks Global promotion authority inside the create transaction", async () => {
  const { manager, create } = await fixture();
  const db = interceptBatch(async () => {
    await env.DB.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(manager.id).run();
  });
  expect(await createAdminPromotion({ db, auth: createAuth(env) }, create)).toMatchObject({
    ok: false,
  });
  expect(
    await env.DB.prepare("SELECT id FROM promotion WHERE code=?").bind(create.code).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(create.idempotencyKey)
      .first(),
  ).toBeNull();
});
it("rejects an edit when activation wins before its transaction", async () => {
  const { meta, create } = await fixture();
  const initial = await exports.default.createAdminPromotion(create);
  if (!initial.ok) throw new Error(initial.error.message);
  const promotionId = initial.value.promotionId;
  const db = interceptBatch(async () => {
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId,
        idempotencyKey: crypto.randomUUID(),
        action: "ACTIVATE",
        reason: "Launch",
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: true });
  });
  const key = crypto.randomUUID();
  expect(
    await updateAdminPromotion(
      { db, auth: createAuth(env) },
      { ...create, promotionId, name: "Changed", idempotencyKey: key, expectedVersion: 1 },
    ),
  ).toMatchObject({ ok: false });
  expect(
    await env.DB.prepare("SELECT name,status,version FROM promotion WHERE id=?")
      .bind(promotionId)
      .first(),
  ).toEqual({ name: "Campaign", status: "ACTIVE", version: 2 });
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
});
it("rejects a grant when deactivation wins before its transaction", async () => {
  const { manager, meta, create } = await fixture();
  const initial = await exports.default.createAdminPromotion(create);
  if (!initial.ok) throw new Error(initial.error.message);
  const promotionId = initial.value.promotionId;
  expect(
    await exports.default.changeAdminPromotionStatus({
      ...meta,
      promotionId,
      idempotencyKey: crypto.randomUUID(),
      action: "ACTIVATE",
      reason: "Launch",
      expectedVersion: 1,
    }),
  ).toMatchObject({ ok: true });
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) SELECT ?,auth_user_id,id,'active',1,?,? FROM customer_principal WHERE auth_user_id=(SELECT auth_user_id FROM staff_identity WHERE id=?)",
  )
    .bind(customerId, Date.now(), Date.now(), manager.id)
    .run();
  const db = interceptBatch(async () => {
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        promotionId,
        idempotencyKey: crypto.randomUUID(),
        action: "DEACTIVATE",
        reason: "Pause campaign",
        expectedVersion: 2,
      }),
    ).toMatchObject({ ok: true });
  });
  const key = crypto.randomUUID();
  expect(
    await grantAdminPromotion(
      { db, auth: createAuth(env) },
      { ...meta, promotionId, customerId, maxRedemptions: 1, idempotencyKey: key },
    ),
  ).toMatchObject({ ok: false });
  expect(
    await env.DB.prepare("SELECT id FROM promotion_grant WHERE customer_id=?")
      .bind(customerId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
});
it("recovers concurrent identical creates with lost responses and one immutable receipt", async () => {
  const { create } = await fixture();
  const deps = { db: interceptBatch(async () => {}, true), auth: createAuth(env) };
  const results = await Promise.all([
    createAdminPromotion(deps, create),
    createAdminPromotion(deps, create),
  ]);
  expect(results[0]).toMatchObject({ ok: true });
  expect(results[1]).toEqual(results[0]);
  expect(
    await env.DB.prepare("SELECT count(*) count FROM promotion WHERE code=?")
      .bind(create.code)
      .first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) count FROM audit_event WHERE idempotency_key=? AND action='PROMOTION.CREATED'",
    )
      .bind(create.idempotencyKey)
      .first(),
  ).toEqual({ count: 1 });
  expect(await createAdminPromotion(deps, { ...create, name: "Other name" })).toMatchObject({
    ok: false,
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
});

for (const benefitType of [
  "DELIVERY_FEE_WAIVER",
  "DELIVERY_PERCENT_DISCOUNT",
  "DELIVERY_FIXED_DISCOUNT",
] as const)
  it(`authors and previews ${benefitType} with caps and usage limits`, async () => {
    const { meta, create } = await fixture();
    const initial = await exports.default.createAdminPromotion({
      ...create,
      benefitType,
      discountMinor: benefitType === "DELIVERY_FIXED_DISCOUNT" ? 999 : undefined,
      percent: benefitType === "DELIVERY_PERCENT_DISCOUNT" ? 25 : undefined,
      maximumDiscountMinor: 500,
    });
    if (!initial.ok) throw new Error(initial.error.message);
    const promotionId = initial.value.promotionId;
    const edited = await exports.default.updateAdminPromotion({
      ...meta,
      idempotencyKey: crypto.randomUUID(),
      promotionId,
      name: "Delivery campaign",
      description: "Delivery saving",
      minimumMinor: 1000,
      startsAt: create.startsAt,
      expectedVersion: 1,
      maximumDiscountMinor: 50,
      globalUsageLimit: 10,
      perCustomerUsageLimit: 1,
      automatic: true,
    });
    expect(edited).toMatchObject({
      ok: true,
      value: {
        benefitType,
        maximumDiscountMinor: 50,
        globalUsageLimit: 10,
        perCustomerUsageLimit: 1,
        automatic: true,
      },
    });
    expect(
      await exports.default.changeAdminPromotionStatus({
        ...meta,
        idempotencyKey: crypto.randomUUID(),
        promotionId,
        expectedVersion: 2,
        action: "ACTIVATE",
        reason: "Launch",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await exports.default.previewAdminPromotion({
        ...meta,
        promotionId,
        subtotalMinor: 2001,
        deliverySubtotalMinor: 1001,
      }),
    ).toMatchObject({ ok: true, value: { discountMinor: 50 } });
    expect(
      await exports.default.previewAdminPromotion({ ...meta, promotionId, subtotalMinor: 2001 }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

it("rejects a grant when customer commerce access is disabled before its transaction", async () => {
  const { manager, meta, create } = await fixture();
  const initial = await exports.default.createAdminPromotion(create);
  if (!initial.ok) throw new Error(initial.error.message);
  const promotionId = initial.value.promotionId;
  expect(
    await exports.default.changeAdminPromotionStatus({
      ...meta,
      promotionId,
      idempotencyKey: crypto.randomUUID(),
      action: "ACTIVATE",
      reason: "Launch",
      expectedVersion: 1,
    }),
  ).toMatchObject({ ok: true });
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,principal_id,status,version,created_at,updated_at) SELECT ?,auth_user_id,id,'active',1,?,? FROM customer_principal WHERE auth_user_id=(SELECT auth_user_id FROM staff_identity WHERE id=?)",
  )
    .bind(customerId, Date.now(), Date.now(), manager.id)
    .run();
  const db = interceptBatch(async () => {
    await env.DB.prepare(
      "UPDATE customer_principal SET status='disabled' WHERE id=(SELECT principal_id FROM customer WHERE id=?)",
    )
      .bind(customerId)
      .run();
  });
  const key = crypto.randomUUID();
  expect(
    await grantAdminPromotion(
      { db, auth: createAuth(env) },
      { ...meta, promotionId, customerId, maxRedemptions: 1, idempotencyKey: key },
    ),
  ).toMatchObject({ ok: false });
  expect(
    await env.DB.prepare("SELECT id FROM promotion_grant WHERE customer_id=?")
      .bind(customerId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
});
