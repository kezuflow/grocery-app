import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  listProcurementRequirements: vi.fn(),
  aggregateAdminProcurementDemand: vi.fn(),
  listReceivingSessions: vi.fn(),
  startAdminReceiving: vi.fn(),
  recordAdminReceivedLine: vi.fn(),
  completeAdminReceiving: vi.fn(),
  listFulfillmentQueue: vi.fn(),
  advanceAdminFulfillment: vi.fn(),
  listDeliveryOperations: vi.fn(),
  advanceAdminDelivery: vi.fn(),
  getFulfillmentMode: vi.fn(),
  activateFulfillmentMode: vi.fn(),
  listOperationalExceptions: vi.fn(),
  resolveAdminOperationalException: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: coreMocks } }));

import { GET as procurementGet } from "./procurement/route";
import { POST as aggregateProcurement } from "./procurement/aggregate/route";
import { GET as receivingGet } from "./receiving/route";
import { POST as startReceiving } from "./receiving/start/route";
import { POST as recordReceivingLine } from "./receiving/record-line/route";
import { POST as completeReceiving } from "./receiving/complete/route";
import { GET as fulfillmentGet, POST as advanceFulfillment } from "./fulfillment/route";
import { GET as deliveryGet, POST as advanceDelivery } from "./delivery/route";
import { GET as modeGet, POST as activateMode } from "./fulfillment-mode/route";
import { GET as exceptionsGet, POST as resolveException } from "./exceptions/route";

beforeEach(() => {
  for (const mock of Object.values(coreMocks)) mock.mockReset();
});

const cookie = { cookie: "session=admin" };
const ok = { ok: true, value: { items: [], nextCursor: null }, requestId: "request-1" };

function command(url: string, body: unknown, idempotencyKey = "command-1"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...cookie },
    body: JSON.stringify(body),
  });
}

describe("admin operations BFF routes", () => {
  it("forwards scoped queue filters and request cookies to Core", async () => {
    coreMocks.listProcurementRequirements.mockResolvedValue(ok);
    coreMocks.listReceivingSessions.mockResolvedValue(ok);
    coreMocks.listFulfillmentQueue.mockResolvedValue(ok);
    coreMocks.listDeliveryOperations.mockResolvedValue(ok);
    coreMocks.getFulfillmentMode.mockResolvedValue(ok);
    coreMocks.listOperationalExceptions.mockResolvedValue(ok);

    await procurementGet(
      new Request("https://app/procurement?locationId=l1&cycleId=c1&limit=20", { headers: cookie }),
    );
    await receivingGet(
      new Request("https://app/receiving?locationId=l1&cursor=next", { headers: cookie }),
    );
    await fulfillmentGet(
      new Request("https://app/fulfillment?locationId=l1&cycleId=c1", { headers: cookie }),
    );
    await deliveryGet(new Request("https://app/delivery?locationId=l1", { headers: cookie }));
    await modeGet(new Request("https://app/mode?locationId=l1", { headers: cookie }));
    await exceptionsGet(new Request("https://app/exceptions?locationId=l1", { headers: cookie }));

    expect(coreMocks.listProcurementRequirements.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
      cycleId: "c1",
      limit: 20,
      headers: cookie,
    });
    expect(coreMocks.listReceivingSessions.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
      cursor: "next",
      headers: cookie,
    });
    expect(coreMocks.listFulfillmentQueue.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
      cycleId: "c1",
    });
    expect(coreMocks.listDeliveryOperations.mock.calls[0][0]).toMatchObject({ locationId: "l1" });
    expect(coreMocks.getFulfillmentMode.mock.calls[0][0]).toMatchObject({ locationId: "l1" });
    expect(coreMocks.listOperationalExceptions.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
    });
  });

  it("delegates explicit writes with idempotency keys and current expected versions", async () => {
    for (const mock of [
      coreMocks.aggregateAdminProcurementDemand,
      coreMocks.startAdminReceiving,
      coreMocks.recordAdminReceivedLine,
      coreMocks.completeAdminReceiving,
      coreMocks.advanceAdminFulfillment,
      coreMocks.advanceAdminDelivery,
      coreMocks.activateFulfillmentMode,
      coreMocks.resolveAdminOperationalException,
    ])
      mock.mockResolvedValue(ok);

    await aggregateProcurement(
      command("https://app/procurement/aggregate", {
        locationId: "l1",
        cycleId: "c1",
        inventoryPoolId: "p1",
        expectedVersion: 4,
      }),
    );
    await startReceiving(
      command("https://app/receiving/start", {
        locationId: "l1",
        requirementId: "r1",
        expectedVersion: 3,
      }),
    );
    await recordReceivingLine(
      command("https://app/receiving/record-line", {
        locationId: "l1",
        receivingSessionId: "s1",
        acceptedBase: 10,
        rejectedBase: 2,
        expectedVersion: 5,
        reason: "counted",
      }),
    );
    await completeReceiving(
      command("https://app/receiving/complete", {
        locationId: "l1",
        receivingSessionId: "s1",
        expectedVersion: 6,
      }),
    );
    await advanceFulfillment(
      command("https://app/fulfillment", {
        locationId: "l1",
        orderId: "o1",
        action: "PACK",
        expectedVersion: 7,
      }),
    );
    await advanceDelivery(
      command("https://app/delivery", {
        locationId: "l1",
        orderId: "o1",
        action: "DISPATCH",
        expectedVersion: 8,
      }),
    );
    await activateMode(
      command("https://app/mode", {
        locationId: "l1",
        fulfillmentMode: "SCHEDULED",
        cadence: "WEEKLY",
        expectedVersion: 2,
      }),
    );
    await resolveException(
      command("https://app/exceptions", {
        locationId: "l1",
        kind: "DELIVERY_FAILED",
        action: "RETRY_DELIVERY",
        orderId: "o1",
        expectedVersion: 9,
        reason: "rider available",
      }),
    );

    for (const mock of [
      coreMocks.aggregateAdminProcurementDemand,
      coreMocks.startAdminReceiving,
      coreMocks.recordAdminReceivedLine,
      coreMocks.completeAdminReceiving,
      coreMocks.advanceAdminFulfillment,
      coreMocks.advanceAdminDelivery,
      coreMocks.activateFulfillmentMode,
      coreMocks.resolveAdminOperationalException,
    ]) {
      expect(mock.mock.calls[0][0]).toMatchObject({ idempotencyKey: "command-1", headers: cookie });
    }
    expect(coreMocks.advanceAdminDelivery.mock.calls[0][0]).toMatchObject({
      expectedVersion: 8,
      action: "DISPATCH",
    });
  });

  it("rejects writes without idempotency or a current version before Core", async () => {
    const response = await advanceFulfillment(
      new Request("https://app/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: "l1", orderId: "o1", action: "PACK" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.advanceAdminFulfillment).not.toHaveBeenCalled();
  });
});
