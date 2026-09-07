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
  refreshExternalDelivery: vi.fn(),
  advanceFulfillment: vi.fn(),
  getGlobalCommerceConfiguration: vi.fn(),
  pauseSelling: vi.fn(),
  activateGlobalMode: vi.fn(),
  openSelling: vi.fn(),
  listOperationalExceptions: vi.fn(),
  resolveAdminOperationalException: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: coreMocks } }));

import { GET as procurementGet } from "@/app/api/admin/procurement/route";
import { POST as aggregateProcurement } from "@/app/api/admin/procurement/aggregate/route";
import { GET as receivingGet } from "@/app/api/admin/receiving/route";
import { POST as startReceiving } from "@/app/api/admin/receiving/start/route";
import { POST as recordReceivingLine } from "@/app/api/admin/receiving/record-line/route";
import { POST as completeReceiving } from "@/app/api/admin/receiving/complete/route";
import {
  GET as fulfillmentGet,
  POST as advanceFulfillment,
} from "@/app/api/admin/fulfillment/route";
import { POST as refreshDelivery } from "@/app/api/admin/external-deliveries/[dispatch-id]/refresh/route";
import { GET as deliveryGet } from "@/app/api/admin/delivery/route";
import {
  GET as commerceConfigurationGet,
  POST as updateCommerceConfiguration,
} from "@/app/api/admin/commerce-configuration/route";
import { GET as exceptionsGet, POST as resolveException } from "@/app/api/admin/exceptions/route";

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
  it("forwards a bounded provider recovery reference with the authorized command context", async () => {
    coreMocks.refreshExternalDelivery.mockResolvedValue(ok);
    const context = { params: Promise.resolve({ "dispatch-id": "dispatch-1" }) };
    await refreshDelivery(
      command("https://app/delivery/refresh", {
        locationId: "l1",
        expectedVersion: 3,
        providerDeliveryId: "  provider-order-1  ",
      }),
      context,
    );
    expect(coreMocks.refreshExternalDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: "dispatch-1",
        locationId: "l1",
        expectedVersion: 3,
        providerDeliveryId: "provider-order-1",
        idempotencyKey: "command-1",
        headers: expect.objectContaining(cookie),
      }),
    );
    const rejected = await refreshDelivery(
      command("https://app/delivery/refresh", {
        locationId: "l1",
        expectedVersion: 3,
        providerDeliveryId: "x".repeat(201),
      }),
      context,
    );
    expect(rejected.status).toBe(400);
    expect(coreMocks.refreshExternalDelivery).toHaveBeenCalledOnce();
  });
  it("forwards scoped queue filters and request cookies to Core", async () => {
    coreMocks.listProcurementRequirements.mockResolvedValue(ok);
    coreMocks.listReceivingSessions.mockResolvedValue(ok);
    coreMocks.listFulfillmentQueue.mockResolvedValue(ok);
    coreMocks.listDeliveryOperations.mockResolvedValue(ok);
    coreMocks.getGlobalCommerceConfiguration.mockResolvedValue(ok);
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
    await commerceConfigurationGet(new Request("https://app/commerce", { headers: cookie }));
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
    expect(coreMocks.getGlobalCommerceConfiguration.mock.calls[0][0]).toMatchObject({
      headers: cookie,
    });
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
      coreMocks.activateGlobalMode,
      coreMocks.resolveAdminOperationalException,
    ])
      mock.mockResolvedValue(ok);

    await aggregateProcurement(
      command("https://app/procurement/aggregate", {
        locationId: "l1",
        cycleId: "c1",
        inventoryPoolId: "p1",
        skuId: "sku1",
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
        action: "MARK_READY_TO_PACK",
        expectedVersion: 7,
      }),
    );
    await updateCommerceConfiguration(
      command("https://app/commerce", {
        action: "SWITCH_MODE",
        fulfillmentMode: "SCHEDULED",
        cadence: "WEEKLY",
        expectedVersion: 2,
        reason: "Scheduled operations ready",
      }),
    );
    await resolveException(
      command("https://app/exceptions", {
        locationId: "l1",
        kind: "FULFILLMENT_SHORTAGE",
        action: "RETRY_FULFILLMENT",
        orderId: "o1",
        expectedVersion: 9,
        reason: "stock reconciled",
      }),
    );

    for (const mock of [
      coreMocks.aggregateAdminProcurementDemand,
      coreMocks.startAdminReceiving,
      coreMocks.recordAdminReceivedLine,
      coreMocks.completeAdminReceiving,
      coreMocks.advanceAdminFulfillment,
      coreMocks.activateGlobalMode,
      coreMocks.resolveAdminOperationalException,
    ]) {
      expect(mock.mock.calls[0][0]).toMatchObject({ idempotencyKey: "command-1", headers: cookie });
    }
  });

  it("rejects writes without idempotency or a current version before Core", async () => {
    const response = await advanceFulfillment(
      new Request("https://app/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: "l1", orderId: "o1", action: "MARK_PACKED" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.advanceAdminFulfillment).not.toHaveBeenCalled();
  });
});
