import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reachDueCycleCutoff } from "./reach-due-cycle-cutoff";
import { closeCompletedDeliveryCycles } from "./close-completed-delivery-cycles";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

let fixtureCounter = 0;

async function seedCycle(input: {
  status: string;
  cutoffAt: number;
  deliveryDate: number;
}): Promise<string> {
  const id = `cyc-test-${++fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO delivery_cycle (id, market_id, name, order_opens_at, cutoff_at, delivery_date, status, capacity, allocated, version) VALUES (?, 'market-metro-cebu', ?, ?, ?, ?, ?, 10, 0, 1)",
  )
    .bind(id, `cycle ${id}`, NOW - 2 * DAY, input.cutoffAt, input.deliveryDate, input.status)
    .run();
  return id;
}

type OrderStatus =
  | "COMMITTED"
  | "IN_FULFILLMENT"
  | "PACKED"
  | "DISPATCHED"
  | "DELIVERED"
  | "CANCELED";

async function seedOrderWithJob(cycleId: string, status: OrderStatus): Promise<string> {
  const customerId = `cust-cyc-${++fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO customer (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
  )
    .bind(customerId, `auth-${customerId}`, NOW, NOW)
    .run();
  const paymentId = `pay-${fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO payment_attempt (id, customer_id, amount_minor, currency, status, provider, idempotency_key, created_at, updated_at) VALUES (?, ?, 50000, 'PHP', 'SUCCEEDED', 'mock', ?, ?, ?)",
  )
    .bind(paymentId, customerId, `${paymentId}-key`, NOW, NOW)
    .run();
  const orderId = `ord-${fixtureCounter}-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO grocery_order (id, customer_id, cycle_id, address_snapshot_json, status, total_minor, currency, payment_id, created_at) VALUES (?, ?, ?, '{}', ?, 50000, 'PHP', ?, ?)",
  )
    .bind(orderId, customerId, cycleId, status, paymentId, NOW)
    .run();
  if (status === "DELIVERED" || status === "DISPATCHED") {
    await env.DB.prepare(
      "INSERT INTO delivery_job (id, order_id, cycle_id, location_id, zone_id, rider_user_id, status, address_snapshot_json) VALUES (?, ?, ?, 'location-cebu-central', 'zone-cebu-city-core', NULL, ?, '{}')",
    )
      .bind(`job-${orderId}`, orderId, cycleId, status === "DELIVERED" ? "DELIVERED" : "EN_ROUTE")
      .run();
  }
  return orderId;
}

async function cycleRow(
  id: string,
): Promise<{ status: string; version: number } | undefined | null> {
  return env.DB.prepare("SELECT status, version FROM delivery_cycle WHERE id=?")
    .bind(id)
    .first<{ status: string; version: number }>();
}

describe("reachDueCycleCutoff", () => {
  it("claims each due OPEN cycle exactly once and leaves future cycles open", async () => {
    const due = await seedCycle({ status: "OPEN", cutoffAt: NOW - 1, deliveryDate: NOW + DAY });
    const future = await seedCycle({
      status: "OPEN",
      cutoffAt: NOW + DAY,
      deliveryDate: NOW + 2 * DAY,
    });
    expect(await reachDueCycleCutoff(env.DB, NOW)).toBe(1);
    expect((await cycleRow(due))?.status).toBe("CUTOFF_REACHED");
    expect((await cycleRow(future))?.status).toBe("OPEN");
    expect(await reachDueCycleCutoff(env.DB, NOW)).toBe(0);
  });
});

describe("closeCompletedDeliveryCycles", () => {
  it("walks a completed cycle through the legal chain to CLOSED exactly once", async () => {
    const cycleId = await seedCycle({
      status: "CUTOFF_REACHED",
      cutoffAt: NOW - DAY,
      deliveryDate: NOW - 1,
    });
    const orderId = await seedOrderWithJob(cycleId, "DELIVERED");
    expect(orderId).toBeTruthy();
    const summary = await closeCompletedDeliveryCycles(env.DB, NOW);
    expect(summary).toEqual({ considered: 1, closed: 1 });
    const row = await cycleRow(cycleId);
    expect(row?.status).toBe("CLOSED");
    expect(row?.version).toBe(7);
    const repeat = await closeCompletedDeliveryCycles(env.DB, NOW);
    expect(repeat.considered).toBe(0);
  });

  it("closes an empty completed cycle without orders or jobs", async () => {
    const cycleId = await seedCycle({
      status: "CUTOFF_REACHED",
      cutoffAt: NOW - DAY,
      deliveryDate: NOW - 1,
    });
    const summary = await closeCompletedDeliveryCycles(env.DB, NOW);
    expect(summary.closed).toBe(1);
    expect((await cycleRow(cycleId))?.status).toBe("CLOSED");
  });

  it("skips cycles that still hold open work or an unpassed window", async () => {
    const openWork = await seedCycle({
      status: "CUTOFF_REACHED",
      cutoffAt: NOW - DAY,
      deliveryDate: NOW - 1,
    });
    await seedOrderWithJob(openWork, "IN_FULFILLMENT");
    const windowOpen = await seedCycle({
      status: "CUTOFF_REACHED",
      cutoffAt: NOW - DAY,
      deliveryDate: NOW + DAY,
    });
    const summary = await closeCompletedDeliveryCycles(env.DB, NOW);
    expect(summary).toEqual({ considered: 0, closed: 0 });
    expect((await cycleRow(openWork))?.status).toBe("CUTOFF_REACHED");
    expect((await cycleRow(windowOpen))?.status).toBe("CUTOFF_REACHED");
  });
});
