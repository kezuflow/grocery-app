import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { locationManager } from "../../test-location-fixtures";
import { openDueDeliveryCycles } from "../../commerce/application/open-due-delivery-cycles";
import { createCheckoutQuote } from "../../checkout/application/create-checkout-quote";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { cancelAdminDeliveryCycle } from "./delivery-cycle-administration";
import { createAuth } from "../../auth/service";

async function openCycleWithQuote() {
  const staff = await locationManager();
  await env.DB.prepare(
    "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code IN ('fulfillment.read','fulfillment.manage')",
  )
    .bind(staff.id)
    .run();
  const now = Date.now(),
    at = (hours: number) => new Date(now + hours * 3600000).toISOString();
  const saved = await exports.default.saveAdminDeliveryCycleDraft({
    headers: staff.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    marketId: "market-metro-cebu",
    name: "Cancelable cycle",
    expectedVersion: 0,
    reason: "Plan service",
    orderOpensAt: at(-1),
    cutoffAt: at(24),
    procurementAt: at(25),
    preparationAt: at(28),
    pickupAt: at(30),
    windows: [{ name: "Delivery", startsAt: at(31), endsAt: at(33) }],
    participation: [{ zoneId: "zone-cebu-city-core", locationId: "location-cebu-central" }],
  });
  if (!saved.ok) throw new Error(saved.error.message);
  const cycleId = saved.value.cycleId;
  expect(
    await exports.default.scheduleAdminDeliveryCycle({
      headers: staff.headers,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      cycleId,
      expectedVersion: 1,
      reason: "Publish plan",
    }),
  ).toMatchObject({ ok: true });
  await openDueDeliveryCycles(env.DB, now);
  const customerId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY' WHERE id='global'",
    ),
    env.DB.prepare(
      "INSERT INTO customer(id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    ).bind(customerId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO customer_address(id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,status,version,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.32,123.9,'CEBU_CITY_CORE','active',1,?,?)",
    ).bind(customerId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO cart(id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',1,?,?)",
    ).bind(customerId, customerId, now, now),
    env.DB.prepare(
      "INSERT INTO cart_item(cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',5)",
    ).bind(customerId),
  ]);
  const quote = await createCheckoutQuote(
    env.DB,
    {
      customerId,
      cartId: customerId,
      addressId: customerId,
      cartVersion: 1,
      deliveryCycleId: cycleId,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    },
    {
      routeDistance: buildRouteDistancePort({
        ENVIRONMENT: "test",
        ROUTE_DISTANCE_PROVIDER: "mock",
      }),
      deliveryProviders: new Map([["lalamove", createMockDeliveryProvider()]]),
      scheduledDeliveryPartner: { providerCode: "lalamove", serviceType: "MOTORCYCLE" },
    },
  );
  if (!quote.ok) throw new Error(quote.error.message);
  const command = {
    headers: staff.headers,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    cycleId,
    expectedVersion: 3,
    reason: "Cancel unused offering",
  };
  return { command, quote: quote.value, customerId };
}
describe("unpaid cycle cancellation", () => {
  it.each([
    ["claim", "BEFORE INSERT ON idempotency_records"],
    ["transition", "BEFORE UPDATE ON delivery_cycle"],
    ["quote invalidation", "BEFORE UPDATE ON checkout_quote"],
    ["audit", "BEFORE INSERT ON audit_event"],
    ["receipt", "BEFORE UPDATE ON idempotency_records WHEN NEW.status='SUCCEEDED'"],
  ])(
    "requires %s, preserves rejected state and recovers the original command",
    async (_effect, trigger) => {
      const { command, quote } = await openCycleWithQuote();
      await env.DB.exec(
        `CREATE TRIGGER ignore_cycle_cancel ${trigger} BEGIN SELECT RAISE(IGNORE); END;`,
      );
      try {
        expect(await exports.default.cancelAdminDeliveryCycle(command)).toMatchObject({
          ok: false,
        });
        expect(
          await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
            .bind(command.cycleId)
            .first(),
        ).toEqual({ status: "OPEN", version: 3 });
        expect(
          await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
            .bind(quote.quoteId)
            .first(),
        ).toEqual({ status: "ACTIVE" });
        expect(
          await env.DB.prepare(
            "SELECT count(*) count FROM idempotency_records WHERE idempotency_key=?",
          )
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
        expect(
          await env.DB.prepare("SELECT count(*) count FROM audit_event WHERE idempotency_key=?")
            .bind(command.idempotencyKey)
            .first(),
        ).toEqual({ count: 0 });
      } finally {
        await env.DB.exec("DROP TRIGGER ignore_cycle_cancel");
      }
      const canceled = await exports.default.cancelAdminDeliveryCycle(command);
      expect(canceled).toMatchObject({ ok: true, value: { status: "CANCELED", version: 4 } });
      expect(await exports.default.cancelAdminDeliveryCycle(command)).toEqual(canceled);
      expect(
        await exports.default.cancelAdminDeliveryCycle({ ...command, reason: "Other reason" }),
      ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
      expect(
        await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
          .bind(quote.quoteId)
          .first(),
      ).toEqual({ status: "SUPERSEDED" });
    },
  );
  it("blocks a payment that starts after review, then accepts cancellation only after definite failure", async () => {
    const { command, quote, customerId } = await openCycleWithQuote();
    const paymentId = crypto.randomUUID();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await env.DB.prepare(
              "INSERT INTO payment_intent(id,purpose,subject_type,subject_id,customer_id,amount_minor,currency,status,idempotency_key,version,created_at,updated_at) VALUES (?,'GROCERY_CHECKOUT','checkout_quote',?,?,?,'PHP','INITIATED',?,1,1,1)",
            )
              .bind(paymentId, quote.quoteId, customerId, quote.totalMinor, paymentId)
              .run();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await cancelAdminDeliveryCycle({ auth: createAuth(env), db }, command)).toMatchObject({
      ok: false,
    });
    expect(
      await env.DB.prepare("SELECT status,version FROM delivery_cycle WHERE id=?")
        .bind(command.cycleId)
        .first(),
    ).toEqual({ status: "OPEN", version: 3 });
    expect(
      await env.DB.prepare("SELECT status FROM checkout_quote WHERE id=?")
        .bind(quote.quoteId)
        .first(),
    ).toEqual({ status: "ACTIVE" });
    expect(await exports.default.cancelAdminDeliveryCycle(command)).toMatchObject({
      ok: false,
      error: { message: "Resolve started payments before canceling this cycle" },
    });
    await env.DB.prepare("UPDATE payment_intent SET status='FAILED' WHERE id=?")
      .bind(paymentId)
      .run();
    expect(await exports.default.cancelAdminDeliveryCycle(command)).toMatchObject({ ok: true });
  });
});
