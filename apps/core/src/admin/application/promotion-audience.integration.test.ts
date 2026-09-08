import type { AdminPromotionAudienceUpdateRequest } from "@freshmarkets/contracts";
import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { locationManager } from "../../test-location-fixtures";
import { createAuth } from "../../auth/service";
import { setAdminPromotionAudience } from "./promotion-audience";
async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.read','promotions.manage','customers.read')",
  )
    .bind(manager.id)
    .run();
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,principal_id,status,created_at,updated_at) SELECT ?,auth_user_id,id,'active',1,1 FROM customer_principal WHERE auth_user_id=(SELECT auth_user_id FROM staff_identity WHERE id=?)",
  )
    .bind(customerId, manager.id)
    .run();
  const meta = { headers: manager.headers, requestId: crypto.randomUUID() };
  const created = await exports.default.createAdminPromotion({
    ...meta,
    idempotencyKey: crypto.randomUUID(),
    code: `AUDIENCE_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
    name: "Audience campaign",
    description: "",
    benefitType: "ORDER_FIXED_DISCOUNT",
    discountMinor: 500,
    minimumMinor: 0,
    startsAt: new Date(Date.now() - 1000).toISOString(),
  });
  if (!created.ok) throw new Error(created.error.message);
  return { manager, meta, customerId, promotionId: created.value.promotionId };
}
it("authors a customer audience, preserves original replay after activation and evaluates it at preview", async () => {
  const { meta, customerId, promotionId } = await fixture();
  const input: AdminPromotionAudienceUpdateRequest = {
    ...meta,
    promotionId,
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
    rules: [
      { type: "FIRST_ORDER" as const, parameters: {} },
      { type: "SPECIFIC_CUSTOMERS" as const, parameters: { customerIds: [customerId] } },
    ],
  };
  const saved = await exports.default.setAdminPromotionAudience(input);
  expect(saved).toMatchObject({ ok: true, value: { version: 2, rules: input.rules } });
  const read = await exports.default.getAdminPromotionAudience({ ...meta, promotionId });
  expect(read).toMatchObject({
    ok: true,
    value: {
      rules: input.rules,
      unsupportedRuleCount: 0,
      customers: [expect.objectContaining({ customerId })],
    },
  });
  expect(
    await exports.default.changeAdminPromotionStatus({
      ...meta,
      promotionId,
      action: "ACTIVATE",
      reason: "Launch",
      expectedVersion: 2,
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: true });
  expect(await exports.default.setAdminPromotionAudience(input)).toEqual(saved);
  expect(await exports.default.setAdminPromotionAudience({ ...input, rules: [] })).toMatchObject({
    ok: false,
    error: { code: "IDEMPOTENCY_CONFLICT" },
  });
  expect(
    await exports.default.previewAdminPromotion({
      ...meta,
      promotionId,
      customerId,
      subtotalMinor: 10000,
    }),
  ).toMatchObject({ ok: true, value: { eligible: true, discountMinor: 500 } });
});
for (const effect of ["promotion", "rule-delete", "rule-insert", "audit", "receipt"])
  it(`rolls back every audience effect when ${effect} is suppressed`, async () => {
    const { meta, promotionId } = await fixture();
    expect(
      await exports.default.setAdminPromotionAudience({
        ...meta,
        promotionId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        rules: [{ type: "FIRST_ORDER", parameters: {} }],
      }),
    ).toMatchObject({ ok: true });
    const before = (
      await env.DB.prepare("SELECT * FROM promotion_rule WHERE promotion_id=?")
        .bind(promotionId)
        .all()
    ).results;
    const event =
      effect === "promotion"
        ? "UPDATE ON promotion"
        : effect === "rule-delete"
          ? "DELETE ON promotion_rule"
          : effect === "rule-insert"
            ? "INSERT ON promotion_rule"
            : effect === "audit"
              ? "INSERT ON audit_event WHEN NEW.action='PROMOTION.AUDIENCE_UPDATED'"
              : "UPDATE ON idempotency_records WHEN NEW.scope='admin.promotions.audience' AND NEW.status='SUCCEEDED'";
    await env.DB.exec(
      `CREATE TRIGGER suppress_audience_effect BEFORE ${event} BEGIN SELECT RAISE(IGNORE); END;`,
    );
    const key = crypto.randomUUID();
    try {
      expect(
        await exports.default.setAdminPromotionAudience({
          ...meta,
          promotionId,
          expectedVersion: 2,
          idempotencyKey: key,
          rules: [{ type: "NEW_CUSTOMER", parameters: {} }],
        }),
      ).toMatchObject({ ok: false });
    } finally {
      await env.DB.exec("DROP TRIGGER suppress_audience_effect;");
    }
    expect(
      (
        await env.DB.prepare("SELECT * FROM promotion_rule WHERE promotion_id=?")
          .bind(promotionId)
          .all()
      ).results,
    ).toEqual(before);
    expect(
      await env.DB.prepare("SELECT version FROM promotion WHERE id=?").bind(promotionId).first(),
    ).toEqual({ version: 2 });
    expect(
      await env.DB.prepare(
        "SELECT idempotency_key FROM idempotency_records WHERE idempotency_key=?",
      )
        .bind(key)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?").bind(key).first(),
    ).toBeNull();
  });
for (const change of ["customer", "segment", "authority", "activation"])
  it(`rejects a raced ${change} change without a partial audience`, async () => {
    const { manager, meta, promotionId, customerId } = await fixture();
    const segmentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO customer_segment(id,code,name,status) VALUES (?,?,'Local customers','ACTIVE')",
    )
      .bind(segmentId, segmentId)
      .run();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            if (change === "customer")
              await env.DB.prepare(
                "UPDATE customer_principal SET status='disabled' WHERE id=(SELECT principal_id FROM customer WHERE id=?)",
              )
                .bind(customerId)
                .run();
            if (change === "segment")
              await env.DB.prepare("UPDATE customer_segment SET status='INACTIVE' WHERE id=?")
                .bind(segmentId)
                .run();
            if (change === "authority")
              await env.DB.prepare("DELETE FROM role_permission WHERE role_id=?")
                .bind(manager.id)
                .run();
            if (change === "activation")
              expect(
                await exports.default.changeAdminPromotionStatus({
                  ...meta,
                  promotionId,
                  action: "ACTIVATE",
                  reason: "Launch",
                  expectedVersion: 1,
                  idempotencyKey: crypto.randomUUID(),
                }),
              ).toMatchObject({ ok: true });
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const key = crypto.randomUUID();
    expect(
      await setAdminPromotionAudience(
        { db, auth: createAuth(env) },
        {
          ...meta,
          promotionId,
          expectedVersion: 1,
          idempotencyKey: key,
          rules: [
            { type: "SPECIFIC_CUSTOMERS", parameters: { customerIds: [customerId] } },
            { type: "CUSTOMER_SEGMENT", parameters: { segmentId } },
          ],
        },
      ),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM promotion_rule WHERE promotion_id=?")
        .bind(promotionId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT idempotency_key FROM idempotency_records WHERE idempotency_key=?",
      )
        .bind(key)
        .first(),
    ).toBeNull();
  });
it("keeps unsupported retained conditions ineligible and requires explicit replacement before activation", async () => {
  const { meta, promotionId } = await fixture();
  await env.DB.prepare(
    "INSERT INTO promotion_rule(id,promotion_id,rule_type,parameters_json) VALUES (?,?,'MEMBER','{}')",
  )
    .bind(crypto.randomUUID(), promotionId)
    .run();
  expect(await exports.default.getAdminPromotionAudience({ ...meta, promotionId })).toMatchObject({
    ok: true,
    value: { rules: [], unsupportedRuleCount: 1 },
  });
  const activation = {
    ...meta,
    promotionId,
    action: "ACTIVATE" as const,
    reason: "Launch",
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
  };
  expect(await exports.default.changeAdminPromotionStatus(activation)).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_FAILED" },
  });
  expect(
    await exports.default.setAdminPromotionAudience({
      ...meta,
      promotionId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      rules: [],
    }),
  ).toMatchObject({ ok: true, value: { rules: [], version: 2 } });
  expect(
    await exports.default.changeAdminPromotionStatus({ ...activation, expectedVersion: 2 }),
  ).toMatchObject({ ok: true });
});
it("denies invalid rule shapes, stale versions and unauthorized direct commands", async () => {
  const { meta, promotionId } = await fixture();
  const input = {
    ...meta,
    promotionId,
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
    rules: [{ type: "FIRST_ORDER", parameters: {} }],
  };
  expect(
    await setAdminPromotionAudience(
      { db: env.DB, auth: createAuth(env) },
      { ...input, rules: [{ type: "MEMBER", parameters: {} }] },
    ),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(
    await setAdminPromotionAudience(
      { db: env.DB, auth: createAuth(env) },
      { ...input, rules: [{ type: "FIRST_ORDER", parameters: { expression: "return true" } }] },
    ),
  ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  expect(
    await setAdminPromotionAudience(
      { db: env.DB, auth: createAuth(env) },
      { ...input, headers: {} },
    ),
  ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  expect(
    await setAdminPromotionAudience(
      { db: env.DB, auth: createAuth(env) },
      { ...input, expectedVersion: 2 },
    ),
  ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
});

it("keeps Customer labels private from campaign readers without customer-read access", async () => {
  const { manager, meta, promotionId, customerId } = await fixture();
  expect(
    await exports.default.setAdminPromotionAudience({
      ...meta,
      promotionId,
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      rules: [{ type: "SPECIFIC_CUSTOMERS", parameters: { customerIds: [customerId] } }],
    }),
  ).toMatchObject({ ok: true });
  await env.DB.prepare(
    "DELETE FROM role_permission WHERE role_id=? AND permission_id=(SELECT id FROM permission WHERE code='customers.read')",
  )
    .bind(manager.id)
    .run();
  expect(await exports.default.getAdminPromotionAudience({ ...meta, promotionId })).toMatchObject({
    ok: true,
    value: {
      customers: [],
      rules: [{ type: "SPECIFIC_CUSTOMERS", parameters: { customerIds: [customerId] } }],
    },
  });
  await env.DB.prepare(
    "UPDATE staff_scope SET scope_kind='location',location_id='location-cebu-central' WHERE staff_id=?",
  )
    .bind(manager.id)
    .run();
  expect(await exports.default.getAdminPromotionAudience({ ...meta, promotionId })).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  expect(
    await exports.default.setAdminPromotionAudience({
      ...meta,
      promotionId,
      expectedVersion: 2,
      idempotencyKey: crypto.randomUUID(),
      rules: [],
    }),
  ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
