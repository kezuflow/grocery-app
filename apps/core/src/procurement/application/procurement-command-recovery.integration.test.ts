import { describe, it, expect } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { seedTestCycle } from "../../test-commerce-fixtures";
import { createAuth } from "../../auth/service";
import {
  aggregateAdminProcurementDemand,
  confirmAdminProcurementPurchase,
} from "../../admin/application/operations-commands";
import { createProcurementRequirement } from "./create-procurement-requirement";
import { ingestProviderEvent } from "../../payments/application/ingest-provider-event";
import {
  createMockPaymentProvider,
  mockSignatureFor,
} from "../../payments/infrastructure/providers/mock-payment-provider";
import { ProviderRegistry } from "../../payments/infrastructure/providers/provider-registry";
const core = exports.default;
async function pendingPayment(cycleId: string, kind: "original" | "addition") {
  const id = crypto.randomUUID();
  if (kind === "original") {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,created_at,updated_at) VALUES (?,?,'Test','Test','09000000000','{}',10,123,1,1)",
      ).bind(id, cycleId),
      env.DB.prepare(
        "INSERT INTO checkout_quote(id,attempt_id,customer_id,cart_id,address_id,delivery_cycle_id,fulfillment_mode,currency,subtotal_minor,total_minor,lines_json,status,expires_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,'SCHEDULED','PHP',100,100,'[]','EXPIRED',1,?,1,1)",
      ).bind(id, id, cycleId, id, id, cycleId, id),
    ]);
  }
  await env.DB.prepare(
    "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,100,'PHP','PROCESSING',?,1,1)",
  )
    .bind(
      id,
      kind === "original" ? "GROCERY_CHECKOUT" : "ORDER_AMENDMENT",
      kind === "original" ? "checkout_quote" : "paid_order_amendment",
      id,
      cycleId,
      id,
    )
    .run();
  if (kind === "addition")
    await env.DB.prepare(
      "INSERT INTO paid_order_amendment(id,order_id,status,currency,total_minor,payment_intent_id,idempotency_key,created_at,updated_at) VALUES (?,?,'PENDING_PAYMENT','PHP',100,?,?,1,1)",
    )
      .bind(id, cycleId, id, id)
      .run();
  await env.DB.prepare(
    "INSERT INTO payment_attempt(id,customer_id,payment_intent_id,amount_minor,currency,status,provider,provider_reference,idempotency_key,created_at,updated_at) VALUES (?,?,?,100,'PHP','PROCESSING','mock',?,?,1,1)",
  )
    .bind(id, cycleId, id, id, id)
    .run();
  return id;
}

async function failPayment(reference: string) {
  const rawBody = JSON.stringify({
    eventId: crypto.randomUUID(),
    reference,
    vendorState: "failed",
    amountMinor: 100,
    currency: "PHP",
  });
  const headers = new Headers({
    "x-mock-signature": await mockSignatureFor(rawBody),
    "x-mock-timestamp": String(Date.now()),
  });
  const result = await ingestProviderEvent(
    env.DB,
    new ProviderRegistry("test", [createMockPaymentProvider()]),
    "mock",
    headers,
    rawBody,
  );
  expect(result.ok).toBe(true);
  expect(
    await env.DB.prepare("SELECT status FROM payment_intent WHERE id=?").bind(reference).first(),
  ).toEqual({ status: "FAILED" });
}
async function fixture(cutoff = Date.now() - 1000) {
  const manager = await locationManager("location"),
    id = crypto.randomUUID();
  await seedTestCycle(env.DB, id);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.manage'",
    ).bind(manager.id),
    env.DB.prepare("UPDATE delivery_cycle SET cutoff_at=? WHERE id=?").bind(cutoff, id),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',1,1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(id, id, id),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
    ).bind(id, id, id, id),
    env.DB.prepare(
      "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',1,100,100,500,'GRAM',500)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES (?,?,?,'location-cebu-central','pool-red-onion',500,'OPEN','EXACT_PAID_LINE',?,'sku-red-onion-500g',1,500,'GRAM',500,1)",
    ).bind(id, id, id, id),
  ]);
  return {
    manager,
    id,
    request: {
      headers: manager.headers,
      requestId: crypto.randomUUID(),
      cycleId: id,
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-red-onion",
      skuId: "sku-red-onion-500g",
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
      reason: "Buy exact paid demand",
      expectedQuantityBase: 500,
      expectedQuantitySellable: 1,
    },
  };
}
async function noEffects(cycleId: string, key: string) {
  expect(
    await env.DB.prepare("SELECT id FROM procurement_run WHERE delivery_cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM procurement_requirement WHERE delivery_cycle_id=?")
      .bind(cycleId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT status FROM idempotency_records WHERE idempotency_key=?")
      .bind(key)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM audit_event WHERE idempotency_key=?").bind(key).first(),
  ).toBeNull();
}
async function destinationDemand(
  cycleId: string,
  locationId: string,
  units: number,
  status = "OPEN",
) {
  const id = crypto.randomUUID(),
    quantity = units * 500;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_attempt(id,customer_id,amount_minor,currency,status,provider,idempotency_key,created_at,updated_at) VALUES (?,?,100,'PHP','SUCCEEDED','mock',?,1,1)",
    ).bind(id, cycleId, id),
    env.DB.prepare(
      "INSERT INTO grocery_order(id,customer_id,payment_id,cycle_id,fulfillment_mode,status,total_minor,currency,address_snapshot_json,created_at) VALUES (?,?,?,?,'SCHEDULED','COMMITTED',100,'PHP','{}',1)",
    ).bind(id, cycleId, id, cycleId),
    env.DB.prepare(
      "INSERT INTO order_item(id,order_id,sku_id,product_name_snapshot,variant_name_snapshot,unit_snapshot,quantity,unit_price_minor,line_total_minor,base_quantity,base_unit_code_snapshot,shipping_weight_grams) VALUES (?,?,'sku-red-onion-500g','Red onion','500 g','GRAM',?,100,100,?,'GRAM',?)",
    ).bind(id, id, units, quantity, quantity),
    env.DB.prepare(
      "INSERT INTO committed_demand(id,order_id,delivery_cycle_id,location_id,inventory_pool_id,quantity,status,demand_basis,order_item_id,sku_id,quantity_sellable,quantity_base_total,base_unit_code,shipping_weight_grams,committed_at) VALUES (?,?,?,?,'pool-red-onion',?,?,'EXACT_PAID_LINE',?,'sku-red-onion-500g',?,?,'GRAM',?,1)",
    ).bind(id, id, cycleId, locationId, quantity, status, id, units, quantity, quantity),
  ]);
}

it("reviews only a receiving requirement's Orders and retains released demand while refunds are pending", async () => {
  const { id, request, manager } = await fixture();
  const global = await locationManager("global");
  for (const staffId of [manager.id, global.id])
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('procurement.read','fulfillment.read','fulfillment.manage','orders.manage')",
    )
      .bind(staffId)
      .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,100,'PHP','SUCCEEDED',?,1,1)",
    ).bind(id, id, id, id),
    env.DB.prepare(
      "UPDATE payment_attempt SET payment_intent_id=?,provider_reference=? WHERE id=?",
    ).bind(id, `mock_pay_${id}`, id),
    env.DB.prepare(
      "INSERT INTO order_payment_reaction(id,payment_intent_id,reaction_id,order_id,applied_at) VALUES (?,?,?,?,1)",
    ).bind(id, id, id, id),
    env.DB.prepare(
      "INSERT INTO order_fulfillment_snapshot(order_id,location_id,cycle_id,zone_id,cutoff_at,delivery_date,fulfillment_mode,sourcing_modes_json,created_at) VALUES (?,'location-cebu-central',?,'zone-cebu-city-core',1,2,'SCHEDULED','[]',1)",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO fulfillment_record(id,order_id,location_id,status,version,updated_at) VALUES (?,?,'location-cebu-central','NOT_STARTED',1,1)",
    ).bind(id, id),
  ]);
  const purchased = await core.confirmAdminProcurementPurchase(request);
  if (!purchased.ok) throw new Error(JSON.stringify(purchased));
  const started = await core.startAdminReceiving({
    ...request,
    requirementId: purchased.value.requirementId,
    expectedVersion: purchased.value.version,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const received = await core.recordAdminReceivedLine({
    ...request,
    receivingSessionId: started.value.receivingSessionId,
    expectedVersion: started.value.version,
    acceptedBase: 0,
    rejectedBase: 100,
    shortageBase: 400,
    reason: "Supplier cannot replace these goods",
    idempotencyKey: crypto.randomUUID(),
  });
  expect(received).toMatchObject({ ok: true, value: { rejectedBase: 100, shortageBase: 400 } });
  const query = {
    ...request,
    section: "ORDERS" as const,
    requirementId: purchased.value.requirementId,
  };
  expect(await core.getAdminScheduledWeek(query)).toMatchObject({
    ok: true,
    value: {
      page: {
        requirement: { id: purchased.value.requirementId },
        items: [{ orderId: id, openQuantityBase: 500, cancellationStatus: null }],
      },
    },
  });
  const cancellation = {
    headers: global.headers,
    requestId: crypto.randomUUID(),
    orderId: id,
    expectedVersion: 1,
    reason: "Supplier cannot replace missing and rejected goods",
    idempotencyKey: crypto.randomUUID(),
  };
  expect(await core.cancelAdminOrder({ ...cancellation, headers: manager.headers })).toMatchObject({
    ok: false,
  });
  const canceled = await core.cancelAdminOrder(cancellation);
  expect(canceled).toMatchObject({ ok: true });
  expect(await core.cancelAdminOrder(cancellation)).toEqual(canceled);
  const after = await core.getAdminScheduledWeek(query);
  expect(after).toMatchObject({
    ok: true,
    value: { page: { items: [{ orderId: id, openQuantityBase: 0 }] } },
  });
  if (!after.ok || after.value.page.kind !== "ORDERS")
    throw new Error("Missing cancellation progress");
  expect(after.value.page.items[0]?.cancellationStatus).toBe("REFUNDS_PROCESSING");
  const fulfillment = await env.DB.prepare(
    "SELECT version FROM fulfillment_record WHERE order_id=?",
  )
    .bind(id)
    .first<{ version: number }>();
  if (!fulfillment) throw new Error("Missing existing fulfillment");
  expect(
    await core.advanceAdminFulfillment({
      headers: global.headers,
      requestId: crypto.randomUUID(),
      locationId: request.locationId,
      orderId: id,
      action: "START_PICKING",
      expectedVersion: fulfillment.version,
      idempotencyKey: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
  expect(
    await env.DB.prepare("SELECT rejected_quantity,shortage_base FROM receiving_record WHERE id=?")
      .bind(started.value.receivingSessionId)
      .first(),
  ).toEqual({ rejected_quantity: 100, shortage_base: 400 });
  expect(await core.getAdminScheduledWeek({ ...query, cycleId: "another-week" })).toMatchObject({
    ok: false,
  });
  expect(
    await core.getAdminScheduledWeek({ ...query, requirementId: "another-requirement" }),
  ).toMatchObject({ ok: false });
});

it("consolidates destinations only for Global readers and keeps purchase writes destination-specific", async () => {
  const { id, manager, request } = await fixture();
  const global = await locationManager("global");
  const destinationId = `destination-${id}`;
  await env.DB.prepare(
    "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,'Second destination','FULFILLMENT_CENTER',10,123,'active',1,1)",
  )
    .bind(destinationId, destinationId)
    .run();
  for (const staffId of [manager.id, global.id])
    await env.DB.prepare(
      "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.read'",
    )
      .bind(staffId)
      .run();
  await destinationDemand(id, destinationId, 3);
  await destinationDemand(id, destinationId, 7, "CANCELED");
  const query = { headers: global.headers, requestId: crypto.randomUUID(), cycleId: id };
  const result = await core.getAdminScheduledWeek(query);
  if (!result.ok || result.value.page.kind !== "DEMAND")
    throw new Error("Missing consolidated demand");
  expect(result.value.page.items).toHaveLength(2);
  expect(
    result.value.page.items.map((row) => [
      row.locationId,
      row.quantityBase,
      row.totalQuantityBase,
      row.canConfirmPurchase,
    ]),
  ).toEqual([
    [destinationId, 1500, 2000, false],
    ["location-cebu-central", 500, 2000, false],
  ]);
  const local = await core.getAdminScheduledWeek({
    ...query,
    headers: manager.headers,
    locationId: request.locationId,
  });
  expect(local).toMatchObject({
    ok: true,
    value: {
      page: {
        items: [{ locationId: request.locationId, quantityBase: 500, totalQuantityBase: 500 }],
      },
    },
  });
  expect(await core.getAdminScheduledWeek({ ...query, headers: manager.headers })).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  expect(
    await core.getAdminScheduledWeek({
      ...query,
      headers: manager.headers,
      locationId: destinationId,
    }),
  ).toMatchObject({ ok: false });
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.manage'",
  )
    .bind(global.id)
    .run();
  expect(
    await core.confirmAdminProcurementPurchase({ ...request, headers: global.headers }),
  ).toMatchObject({ ok: true });
  const after = await core.getAdminScheduledWeek(query);
  if (!after.ok || after.value.page.kind !== "DEMAND")
    throw new Error("Missing purchased projection");
  expect(
    after.value.page.items.map((row) => [row.locationId, row.status, row.totalQuantityBase]),
  ).toEqual([
    [destinationId, "NOT_PURCHASED", 2000],
    ["location-cebu-central", "ORDERED", 2000],
  ]);
});

it("keeps full SKU totals across bounded destination pages without duplicate or missing rows", async () => {
  const { id } = await fixture();
  const global = await locationManager("global");
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.read'",
  )
    .bind(global.id)
    .run();
  for (let index = 0; index < 50; index++) {
    const locationId = `page-${id}-${index}`;
    await env.DB.prepare(
      "INSERT INTO fulfillment_location(id,market_id,code,name,type,latitude,longitude,status,created_at,updated_at) VALUES (?,'market-metro-cebu',?,?,'FULFILLMENT_CENTER',10,123,'active',1,1)",
    )
      .bind(locationId, locationId, `Destination ${index}`)
      .run();
    await destinationDemand(id, locationId, 1);
  }
  const query = { headers: global.headers, requestId: crypto.randomUUID(), cycleId: id };
  const first = await core.getAdminScheduledWeek(query);
  if (!first.ok || first.value.page.kind !== "DEMAND" || !first.value.page.nextCursor)
    throw new Error("Missing destination page");
  expect(first.value.page.items).toHaveLength(50);
  const second = await core.getAdminScheduledWeek({
    ...query,
    cursor: first.value.page.nextCursor,
  });
  if (!second.ok || second.value.page.kind !== "DEMAND") throw new Error("Missing final page");
  expect(second.value.page.items).toHaveLength(1);
  expect(second.value.page.nextCursor).toBeNull();
  const rows = [...first.value.page.items, ...second.value.page.items];
  expect(new Set(rows.map((row) => row.locationId)).size).toBe(51);
  expect(
    rows.every((row) => row.totalQuantityBase === 25500 && row.totalQuantitySellable === 51),
  ).toBe(true);
});
describe("procurement command transaction and recovery", () => {
  it.each(["original", "addition"] as const)(
    "waits for a started %s payment despite browser expiry, then purchases after provider-confirmed failure",
    async (kind) => {
      const { id, request } = await fixture();
      const paymentId = await pendingPayment(id, kind);
      expect(await core.confirmAdminProcurementPurchase(request)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      await noEffects(id, request.idempotencyKey);
      await failPayment(paymentId);
      const result = await core.confirmAdminProcurementPurchase(request);
      expect(result).toMatchObject({ ok: true, value: { requiredQuantityBase: 500 } });
      expect(await core.confirmAdminProcurementPurchase(request)).toEqual(result);
    },
  );
  it.each(["original", "addition"] as const)(
    "rolls back purchase when unresolved %s evidence appears at the batch boundary",
    async (kind) => {
      const { id, request } = await fixture();
      let reached = false;
      const database = new Proxy(env.DB, {
        get(target, key) {
          if (key === "batch")
            return async (statements: D1PreparedStatement[]) => {
              reached = true;
              await pendingPayment(id, kind);
              return target.batch(statements);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(
        await confirmAdminProcurementPurchase({ db: database, auth: createAuth(env) }, request),
      ).toMatchObject({ ok: false });
      expect(reached).toBe(true);
      await noEffects(id, request.idempotencyKey);
    },
  );
  it("keeps the legacy RPC operational for committed Scheduled demand after a global mode switch", async () => {
    const { request, id } = await fixture();
    await env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='PAUSED',fulfillment_mode='INSTANT',cadence=NULL,version=version+1 WHERE id='global'",
    ).run();
    const command = { ...request, deliveryCycleId: id };
    const first = await core.createProcurementRequirement(command);
    expect(first).toMatchObject({
      ok: true,
      value: { id: expect.any(String), status: "AGGREGATED" },
    });
    expect(await core.createProcurementRequirement(command)).toEqual(first);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM audit_event WHERE idempotency_key=?")
        .bind(request.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
  describe.each([aggregateAdminProcurementDemand, confirmAdminProcurementPurchase])(
    "%s guards",
    (execute) => {
      it.each(["scope", "permission", "staff", "demand", "cutoff", "late-failure"] as const)(
        "rolls back every dependent effect on %s loss at the write boundary",
        async (kind) => {
          const { manager, id, request } = await fixture();
          let reached = false;
          const database = new Proxy(env.DB, {
            get(target, key) {
              if (key === "batch")
                return async (statements: D1PreparedStatement[]) => {
                  reached = true;
                  if (kind === "scope")
                    await target
                      .prepare("DELETE FROM staff_scope WHERE staff_id=?")
                      .bind(manager.id)
                      .run();
                  if (kind === "permission")
                    await target
                      .prepare("DELETE FROM role_permission WHERE role_id=?")
                      .bind(manager.id)
                      .run();
                  if (kind === "staff")
                    await target
                      .prepare("UPDATE staff_identity SET status='inactive' WHERE id=?")
                      .bind(manager.id)
                      .run();
                  if (kind === "demand")
                    await target
                      .prepare(
                        "UPDATE committed_demand SET status='CANCELED',version=version+1 WHERE id=?",
                      )
                      .bind(id)
                      .run();
                  if (kind === "cutoff")
                    await target
                      .prepare("UPDATE delivery_cycle SET cutoff_at=?,version=version+1 WHERE id=?")
                      .bind(Date.now() + 60000, id)
                      .run();
                  return target.batch(
                    kind === "late-failure"
                      ? [
                          ...statements,
                          target.prepare("INSERT INTO commitment_abort(id) VALUES (-99)"),
                        ]
                      : statements,
                  );
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          expect(await execute({ db: database, auth: createAuth(env) }, request)).toMatchObject({
            ok: false,
          });
          expect(reached).toBe(true);
          await noEffects(id, request.idempotencyKey);
          if (kind === "late-failure")
            expect(await core.aggregateAdminProcurementDemand(request)).toMatchObject({
              ok: true,
              value: { requiredQuantityBase: 500 },
            });
        },
      );
    },
  );
  it("allows aggregation exactly at cutoff and never before it", async () => {
    const { request, id } = await fixture(1000);
    const command = { ...request, deliveryCycleId: id };
    expect(await createProcurementRequirement(env.DB, command, { now: () => 999 })).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
    await noEffects(id, request.idempotencyKey);
    expect(await createProcurementRequirement(env.DB, command, { now: () => 1000 })).toMatchObject({
      ok: true,
      value: { view: { requiredQuantityBase: 500 } },
    });
  });
  it("replays the original result after recalculation and rejects changed versions/reasons", async () => {
    const { request } = await fixture();
    const before = (
      await env.DB.prepare(
        "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
      ).all()
    ).results;
    const first = await core.aggregateAdminProcurementDemand(request);
    expect(first).toMatchObject({ ok: true, value: { version: 1, requiredQuantityBase: 500 } });
    expect(
      await core.aggregateAdminProcurementDemand({
        ...request,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await core.aggregateAdminProcurementDemand(request)).toEqual(first);
    expect(
      await core.aggregateAdminProcurementDemand({ ...request, expectedVersion: 1 }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      await core.aggregateAdminProcurementDemand({ ...request, reason: "Changed" }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM inventory_balance ORDER BY location_id,inventory_pool_id",
        ).all()
      ).results,
    ).toEqual(before);
  });
  it("serializes competing creation without orphan runs or duplicate receipt records", async () => {
    const { request, id } = await fixture();
    const second = { ...request, idempotencyKey: crypto.randomUUID() };
    const results = await Promise.all([
      core.aggregateAdminProcurementDemand(request),
      core.aggregateAdminProcurementDemand(second),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM procurement_run WHERE delivery_cycle_id=?")
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM receiving_record WHERE procurement_requirement_id IN (SELECT id FROM procurement_requirement WHERE delivery_cycle_id=?)",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM idempotency_records WHERE idempotency_key IN (?,?)",
      )
        .bind(request.idempotencyKey, second.idempotencyKey)
        .first(),
    ).toEqual({ count: 1 });
  });
});

describe("normal manual purchase confirmation", () => {
  it("creates the exact purchase and makes the same requirement receivable once", async () => {
    const { request, id } = await fixture();
    const purchased = await core.confirmAdminProcurementPurchase(request);
    expect(purchased).toMatchObject({
      ok: true,
      value: { status: "ORDERED", requiredQuantityBase: 500, version: 1 },
    });
    if (!purchased.ok) throw new Error(purchased.error.message);
    expect(await core.confirmAdminProcurementPurchase(request)).toEqual(purchased);
    expect(
      await env.DB.prepare(
        "SELECT ordered_quantity,status FROM purchase_order WHERE requirement_id=?",
      )
        .bind(purchased.value.requirementId)
        .all(),
    ).toMatchObject({ results: [{ ordered_quantity: 500, status: "ORDERED" }] });
    expect(
      await core.startAdminReceiving({
        headers: request.headers,
        requestId: crypto.randomUUID(),
        locationId: request.locationId,
        requirementId: purchased.value.requirementId,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        reason: "Supplier goods arrived",
      }),
    ).toMatchObject({ ok: true, value: { status: "IN_PROGRESS" } });
    expect(
      await core.confirmAdminProcurementPurchase({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) count FROM purchase_order po JOIN procurement_requirement pr ON pr.id=po.requirement_id WHERE pr.delivery_cycle_id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 1 });
  });
  it("confirms an existing reviewed aggregation without another requirement", async () => {
    const { request } = await fixture();
    const aggregated = await core.aggregateAdminProcurementDemand(request);
    if (!aggregated.ok) throw new Error(aggregated.error.message);
    expect(
      await core.confirmAdminProcurementPurchase({
        ...request,
        expectedVersion: aggregated.value.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({
      ok: true,
      value: { requirementId: aggregated.value.requirementId, status: "ORDERED", version: 2 },
    });
  });
  it.each(["purchase_order", "receiving_record", "audit_event", "idempotency_records"])(
    "rolls back a silently omitted %s effect",
    async (table) => {
      const { request, id } = await fixture();
      const trigger = `ignore_purchase_${table}`;
      await env.DB.exec(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
      );
      try {
        expect(await core.confirmAdminProcurementPurchase(request)).toMatchObject({ ok: false });
        await noEffects(id, request.idempotencyKey);
        expect(
          await env.DB.prepare(
            "SELECT id FROM purchase_order WHERE requirement_id IN (SELECT id FROM procurement_requirement WHERE delivery_cycle_id=?)",
          )
            .bind(id)
            .first(),
        ).toBeNull();
      } finally {
        await env.DB.exec(`DROP TRIGGER ${trigger}`);
      }
    },
  );
  it("rejects before cutoff and allows one concurrent confirmation", async () => {
    const early = await fixture(Date.now() + 60000);
    expect(await core.confirmAdminProcurementPurchase(early.request)).toMatchObject({ ok: false });
    await noEffects(early.id, early.request.idempotencyKey);
    const { request } = await fixture();
    const results = await Promise.all([
      core.confirmAdminProcurementPurchase(request),
      core.confirmAdminProcurementPurchase({ ...request, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});

it("rejects purchase quantities that differ from the reviewed paid demand", async () => {
  const { request, id } = await fixture();
  expect(
    await core.confirmAdminProcurementPurchase({ ...request, expectedQuantityBase: 1000 }),
  ).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  await noEffects(id, request.idempotencyKey);
});
it("shows scoped week demand, purchase and receiving progress without stock netting", async () => {
  const { request, manager } = await fixture();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code='procurement.read'",
  )
    .bind(manager.id)
    .run();
  const query = {
    headers: request.headers,
    requestId: crypto.randomUUID(),
    locationId: request.locationId,
    cycleId: request.cycleId,
  };
  expect(await core.getAdminScheduledWeek(query)).toMatchObject({
    ok: true,
    value: {
      week: { cycleId: request.cycleId },
      page: {
        kind: "DEMAND",
        items: [
          {
            quantityBase: 500,
            quantitySellable: 1,
            status: "NOT_PURCHASED",
            canConfirmPurchase: true,
          },
        ],
      },
    },
  });
  expect(await core.confirmAdminProcurementPurchase(request)).toMatchObject({ ok: true });
  expect(await core.getAdminScheduledWeek(query)).toMatchObject({
    ok: true,
    value: {
      page: {
        kind: "DEMAND",
        items: [{ status: "ORDERED", canConfirmPurchase: false, receivingStatus: "NOT_STARTED" }],
      },
    },
  });
  expect(await core.getAdminScheduledWeek({ ...query, section: "ORDERS" })).toMatchObject({
    ok: true,
    value: { page: { kind: "ORDERS", denied: true, items: [] } },
  });
  expect(await core.getAdminScheduledWeek({ ...query, section: "OFFERS" })).toMatchObject({
    ok: true,
  });
  expect(
    await core.getAdminScheduledWeek({ ...query, locationId: "location-mandaue" }),
  ).toMatchObject({ ok: false });
});

it("recovers a committed purchase when the D1 reply is lost", async () => {
  const { request } = await fixture();
  let committed = false;
  const database = new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await target.batch(statements);
          committed = true;
          throw new Error("Synthetic lost D1 reply");
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await confirmAdminProcurementPurchase(
    { db: database, auth: createAuth(env) },
    request,
  );
  expect(committed).toBe(true);
  expect(result).toMatchObject({ ok: true, value: { status: "ORDERED" } });
  expect(await core.confirmAdminProcurementPurchase(request)).toEqual(result);
  expect(
    await core.confirmAdminProcurementPurchase({ ...request, reason: "Another purchase" }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
});
