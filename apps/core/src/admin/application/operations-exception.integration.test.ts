import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  listOperationalExceptions,
  listOperationalExceptionsForLocations,
} from "../../audit/application/list-operational-exceptions";

describe("converged operational exceptions", () => {
  it("orders and ages receiving discrepancies by persisted UTC timestamps", async () => {
    const suffix = crypto.randomUUID();
    const olderAt = Date.now() - 10 * 60_000;
    const newerAt = Date.now() - 2 * 60_000;
    const ids = { older: `receiving-older-${suffix}`, newer: `receiving-newer-${suffix}` };

    // Insert newer first to prove row insertion order is irrelevant.
    for (const [id, at] of [
      [ids.newer, newerAt],
      [ids.older, olderAt],
    ] as const) {
      const requirementId = `requirement-${id}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version, created_at, updated_at) VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1, ?, ?)",
        ).bind(requirementId, `cycle-${requirementId}`, at, at),
        env.DB.prepare(
          "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version, created_at, updated_at) VALUES (?, ?, 10, 8, 2, 'DISCREPANCY', 1, ?, ?)",
        ).bind(id, requirementId, at, at),
      ]);
    }

    const rows = await listOperationalExceptions(env.DB, { locationId: "location-cebu-central" });
    const receivingRows = rows.filter((row) => [ids.newer, ids.older].includes(row.referenceId));
    expect(receivingRows.map((row) => row.referenceId)).toEqual([ids.newer, ids.older]);
    expect(receivingRows[0]?.ageMinutes).toBeGreaterThanOrEqual(1);
    expect(receivingRows[1]?.ageMinutes).toBeGreaterThan(receivingRows[0]?.ageMinutes ?? 0);

    const afterNewer = await listOperationalExceptions(env.DB, {
      locationId: "location-cebu-central",
      cursorKey: receivingRows[0]?.queueKey,
    });
    expect(afterNewer.some((row) => row.referenceId === ids.older)).toBe(true);
    expect(afterNewer.some((row) => row.referenceId === ids.newer)).toBe(false);
  });

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

  it("reads multiple locations with one bounded D1 statement", async () => {
    const suffix = crypto.randomUUID();
    const secondLocationId = `location-second-${suffix}`;
    const firstRequirementId = `requirement-first-${suffix}`;
    const firstExceptionId = `exception-first-${suffix}`;
    const secondRequirementId = `requirement-second-${suffix}`;
    const secondExceptionId = `exception-second-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO procurement_requirement
          (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version)
         VALUES (?, ?, 'location-cebu-central', 'pool-red-onion', 10, 'ORDERED', 1)`,
      ).bind(firstRequirementId, `cycle-first-${suffix}`),
      env.DB.prepare(
        `INSERT INTO supply_exception
          (id, requirement_id, kind, affected_quantity, status, created_at, version)
         VALUES (?, ?, 'SHORTAGE', 5, 'OPEN', ?, 1)`,
      ).bind(firstExceptionId, firstRequirementId, Date.now() - 1),
      env.DB.prepare(
        `INSERT INTO fulfillment_location
          (id, market_id, code, name, type, latitude, longitude, status, version, created_at, updated_at)
         VALUES (?, 'market-metro-cebu', ?, 'Second location', 'FULFILLMENT_CENTER',
                 10.32, 123.89, 'active', 1, 0, 0)`,
      ).bind(secondLocationId, `SECOND_${suffix.slice(0, 8)}`),
      env.DB.prepare(
        `INSERT INTO procurement_requirement
          (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version)
         VALUES (?, ?, ?, 'pool-red-onion', 10, 'ORDERED', 1)`,
      ).bind(secondRequirementId, `cycle-second-${suffix}`, secondLocationId),
      env.DB.prepare(
        `INSERT INTO supply_exception
          (id, requirement_id, kind, affected_quantity, status, created_at, version)
         VALUES (?, ?, 'SHORTAGE', 5, 'OPEN', ?, 1)`,
      ).bind(secondExceptionId, secondRequirementId, Date.now()),
    ]);

    let prepareCount = 0;
    const countingDatabase = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (sql: string) => {
          prepareCount += 1;
          return target.prepare(sql);
        };
      },
    });
    const rows = await listOperationalExceptionsForLocations(countingDatabase, {
      locationIds: ["location-cebu-central", secondLocationId],
      limit: 100,
    });

    expect(prepareCount).toBe(1);
    expect(rows).toContainEqual(expect.objectContaining({ referenceId: firstExceptionId }));
    expect(rows).toContainEqual(expect.objectContaining({ referenceId: secondExceptionId }));
    const locations = rows.map((row) => row.locationId);
    expect(locations).toContain("location-cebu-central");
    expect(locations).toContain(secondLocationId);
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
      ).bind(requirementId, `cycle-${suffix}`),
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, created_at, version) VALUES (?, ?, 'SHORTAGE', 5, 'OPEN', ?, 1)",
      ).bind(`supply-${suffix}`, requirementId, Date.now()),
      env.DB.prepare(
        "INSERT INTO receiving_record (id, procurement_requirement_id, expected_quantity, accepted_quantity, rejected_quantity, status, version) VALUES (?, ?, 10, 8, 2, 'COMPLETED', 1)",
      ).bind(`receiving-${suffix}`, requirementId),
      env.DB.prepare(
        "INSERT OR REPLACE INTO fulfillment_record (id, order_id, location_id, status, updated_at, version) VALUES (?, ?, 'location-cebu-central', 'SHORTED', ?, 1)",
      ).bind(`fulfillment-${suffix}`, orderId, Date.now()),
      env.DB.prepare(
        "INSERT OR REPLACE INTO delivery_job (id, order_id, cycle_id, location_id, zone_id, rider_user_id, status, address_snapshot_json, version) VALUES (?, ?, ?, 'location-cebu-central', 'zone-cebu-city-core', NULL, 'FAILED', '{}', 1)",
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
      "ESCALATE",
    ]);
  });
});
