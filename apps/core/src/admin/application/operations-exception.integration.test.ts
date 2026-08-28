import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listOperationalExceptions } from "../../audit/application/list-operational-exceptions";

describe("converged operational exceptions", () => {
  it("projects source ownership, scope, severity, age, and legal actions", async () => {
    const requirementId = `exception-requirement-${crypto.randomUUID()}`;
    const exceptionId = `exception-${crypto.randomUUID()}`;
    const createdAt = Date.now() - 120_000;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, 'cycle-next-cebu', 'location-cebu-central', 'pool-red-onion', 100, 'ORDERED', 1)",
      ).bind(requirementId),
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, resolution, created_at, version) VALUES (?, ?, 'SHORTAGE', 1200, 'OPEN', NULL, ?, 1)",
      ).bind(exceptionId, requirementId, createdAt),
    ]);

    const rows = await listOperationalExceptions(env.DB, { locationId: "location-cebu-central" });
    const item = rows.find((row) => row.referenceId === exceptionId);
    expect(item).toMatchObject({
      source: "PROCUREMENT",
      severity: "CRITICAL",
      locationId: "location-cebu-central",
      reason: "SHORTAGE",
      permittedActions: [],
      ownerId: null,
    });
    expect(item?.ageMinutes).toBeGreaterThanOrEqual(1);
  });

  it("derives action sets from actual source rows", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `exception-customer-${suffix}`;
    const paymentId = `exception-payment-${suffix}`;
    const orderId = `exception-order-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      ).bind(customerId, `auth-${suffix}`, Date.now(), Date.now()),
      env.DB.prepare(
        "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at, version) VALUES (?, ?, 100, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?, 1)",
      ).bind(paymentId, customerId, `payment-${suffix}`, Date.now(), Date.now()),
      env.DB.prepare(
        "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at, version) VALUES (?, ?, 'cycle-next-cebu', '{}', 'PAID', 100, 'PHP', ?, ?, 1)",
      ).bind(orderId, customerId, paymentId, Date.now()),
    ]);
    const requirementId = `exception-requirement-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1)",
      ).bind(requirementId, "cycle-next-cebu"),
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at, version) VALUES (?, ?, 'SHORTAGE', 5, 'OPEN', ?, 1)",
      ).bind(`supply-${suffix}`, requirementId, Date.now()),
      env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 10, 8, 2, 'COMPLETED', 1)",
      ).bind(`receiving-${suffix}`, requirementId),
      env.DB.prepare(
        "INSERT OR REPLACE INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, 'location-cebu-central', 'SHORTAGE', ?, 1)",
      ).bind(`fulfillment-${suffix}`, orderId, Date.now()),
      env.DB.prepare(
        "INSERT OR REPLACE INTO delivery_job (id, order_id, cycle_id, rider_user_id, status, address_snapshot_json, version) VALUES (?, ?, ?, NULL, 'FAILED', '{}', 1)",
      ).bind(`delivery-${suffix}`, orderId, "cycle-next-cebu"),
    ]);
    const rows = await listOperationalExceptions(env.DB, { locationId: "location-cebu-central" });
    expect(rows.find((item) => item.source === "PROCUREMENT")?.permittedActions).toEqual([]);
    expect(rows.find((item) => item.source === "RECEIVING")?.permittedActions).toEqual([]);
    expect(rows.find((item) => item.source === "FULFILLMENT")?.permittedActions).toEqual([
      "RETRY_FULFILLMENT",
    ]);
    expect(rows.find((item) => item.source === "DELIVERY")?.permittedActions).toEqual([
      "RETRY_DELIVERY",
    ]);
  });
});
