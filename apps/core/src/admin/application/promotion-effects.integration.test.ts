import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { createAuth } from "../../auth/service";
import {
  createAdminPromotion,
  updateAdminPromotion,
  grantAdminPromotion,
} from "./promotion-commands";
import { locationManager } from "../../test-location-fixtures";

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
describe("Promotion command transaction effects", () => {
  for (const command of ["create", "update", "status", "grant"] as const)
    for (const effect of ["write", "audit", "receipt"] as const)
      it(`rolls back ${command} when ${effect} is suppressed`, async () => {
        const { manager, meta, create } = await fixture();
        const initial = await exports.default.createAdminPromotion(create);
        if (!initial.ok) throw new Error(initial.error.message);
        const promotionId = initial.value.promotionId;
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
          status: command === "grant" ? "ACTIVE" : "DRAFT",
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
