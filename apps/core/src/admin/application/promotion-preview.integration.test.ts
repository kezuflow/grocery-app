import { env, exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { locationManager } from "../../test-location-fixtures";

async function fixture() {
  const manager = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('promotions.read','promotions.manage','customers.read','customers.manage')",
  )
    .bind(manager.id)
    .run();
  const customerId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customer(id,auth_user_id,principal_id,status,created_at,updated_at) SELECT ?,auth_user_id,id,'active',1,1 FROM customer_principal WHERE auth_user_id=(SELECT auth_user_id FROM staff_identity WHERE id=?)",
  )
    .bind(customerId, manager.id)
    .run();
  const request = { headers: manager.headers, requestId: crypto.randomUUID() };
  const created = await exports.default.createAdminPromotion({
    ...request,
    idempotencyKey: crypto.randomUUID(),
    code: `PREVIEW_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
    name: "Customer preview",
    description: "",
    benefitType: "DELIVERY_FIXED_DISCOUNT",
    discountMinor: 3000,
    minimumMinor: 0,
    startsAt: new Date(Date.now() - 1000).toISOString(),
  });
  if (!created.ok) throw new Error(created.error.message);
  const promotionId = created.value.promotionId;
  const active = await exports.default.changeAdminPromotionStatus({
    ...request,
    idempotencyKey: crypto.randomUUID(),
    promotionId,
    expectedVersion: 1,
    action: "ACTIVATE",
    reason: "Launch",
  });
  if (!active.ok) throw new Error(active.error.message);
  return { manager, customerId, promotionId, request };
}
it("uses checkout targeting for the selected customer without creating commerce effects", async () => {
  const { customerId, promotionId, request } = await fixture();
  await env.DB.prepare(
    "INSERT INTO promotion_rule(id,promotion_id,rule_type,parameters_json) VALUES (?,?,'SPECIFIC_CUSTOMERS',?)",
  )
    .bind(crypto.randomUUID(), promotionId, JSON.stringify({ customerIds: ["different-customer"] }))
    .run();
  const input = {
    ...request,
    promotionId,
    customerId,
    subtotalMinor: 10000,
    deliverySubtotalMinor: 5000,
  };
  const denied = await exports.default.previewAdminPromotion(input);
  expect(denied).toMatchObject({
    ok: true,
    value: {
      eligible: false,
      reasonCode: "CUSTOMER_INELIGIBLE",
      discountMinor: null,
      eligibilityChecked: true,
    },
  });
  await env.DB.prepare("UPDATE promotion_rule SET parameters_json=? WHERE promotion_id=?")
    .bind(JSON.stringify({ customerIds: [customerId] }), promotionId)
    .run();
  expect(await exports.default.previewAdminPromotion(input)).toMatchObject({
    ok: true,
    value: { eligible: true, discountMinor: 3000, eligibilityChecked: true },
  });
  for (const table of ["checkout_promotion_claim", "promotion_redemption"])
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE promotion_id=?`)
        .bind(promotionId)
        .first(),
    ).toEqual({ count: 0 });
});
it("requires customer read permission and rejects disabled or missing customers", async () => {
  const { manager, customerId, promotionId, request } = await fixture();
  const input = {
    ...request,
    promotionId,
    customerId,
    subtotalMinor: 10000,
    deliverySubtotalMinor: 5000,
  };
  await env.DB.prepare("UPDATE customer SET status='disabled' WHERE id=?").bind(customerId).run();
  expect(await exports.default.previewAdminPromotion(input)).toMatchObject({
    ok: true,
    value: { eligible: false, reasonCode: "CUSTOMER_UNAVAILABLE" },
  });
  expect(
    await exports.default.previewAdminPromotion({ ...input, customerId: "missing" }),
  ).toMatchObject({ ok: true, value: { eligible: false, reasonCode: "CUSTOMER_UNAVAILABLE" } });
  await env.DB.prepare(
    "DELETE FROM role_permission WHERE role_id=? AND permission_id=(SELECT id FROM permission WHERE code='customers.read')",
  )
    .bind(manager.id)
    .run();
  expect(await exports.default.previewAdminPromotion(input)).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
});
it("identifies an amount-only estimate without claiming customer eligibility", async () => {
  const { promotionId, request } = await fixture();
  expect(
    await exports.default.previewAdminPromotion({
      ...request,
      promotionId,
      subtotalMinor: 10000,
      deliverySubtotalMinor: 5000,
    }),
  ).toMatchObject({
    ok: true,
    value: { eligible: true, discountMinor: 3000, eligibilityChecked: false },
  });
});

for (const limit of ["global", "customer", "grant"] as const)
  it(`checks current ${limit} redemption usage without reserving another use`, async () => {
    const { customerId, promotionId, request } = await fixture();
    const grant = await exports.default.grantAdminPromotion({
      ...request,
      customerId,
      promotionId,
      maxRedemptions: limit === "grant" ? 1 : 2,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!grant.ok) throw new Error(grant.error.message);
    // Seed retained consumption for this read-side case. Actual paid commitments/races are tested in Orders.
    await env.DB.prepare(
      "INSERT INTO promotion_redemption(id,grant_id,benefit_code,benefit_type,customer_id,promotion_id,redeemed_at) SELECT ?,?,code,benefit_type,?,id,? FROM promotion WHERE id=?",
    )
      .bind(crypto.randomUUID(), grant.value.grantId, customerId, Date.now(), promotionId)
      .run();
    if (limit !== "grant")
      expect(
        await exports.default.previewAdminPromotion({
          ...request,
          customerId,
          promotionId,
          subtotalMinor: 10000,
          deliverySubtotalMinor: 5000,
        }),
      ).toMatchObject({ ok: true, value: { eligible: true } });
    if (limit !== "grant")
      await env.DB.prepare(
        `UPDATE promotion SET ${limit === "global" ? "global_usage_limit" : "per_customer_usage_limit"}=1 WHERE id=?`,
      )
        .bind(promotionId)
        .run();
    expect(
      await exports.default.previewAdminPromotion({
        ...request,
        customerId,
        promotionId,
        subtotalMinor: 10000,
        deliverySubtotalMinor: 5000,
      }),
    ).toMatchObject({
      ok: true,
      value: { eligible: false, eligibilityChecked: true, reasonCode: "CUSTOMER_INELIGIBLE" },
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM promotion_redemption WHERE promotion_id=?",
      )
        .bind(promotionId)
        .first(),
    ).toEqual({ count: 1 });
  });
