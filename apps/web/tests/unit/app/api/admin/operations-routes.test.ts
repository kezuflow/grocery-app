import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
  rescheduleAdminDeliveryCycle: vi.fn(),
  listProcurementRequirements: vi.fn(),
  aggregateAdminProcurementDemand: vi.fn(),
  listReceivingSessions: vi.fn(),
  startAdminReceiving: vi.fn(),
  recordAdminReceivedLine: vi.fn(),
  completeAdminReceiving: vi.fn(),
  listFulfillmentQueue: vi.fn(),
  listOperationalActivity: vi.fn(),
  advanceAdminFulfillment: vi.fn(),
  listDeliveryOperations: vi.fn(),
  refreshExternalDelivery: vi.fn(),
  requestExternalDelivery: vi.fn(),
  prepareSharedDelivery: vi.fn(),
  confirmSharedDelivery: vi.fn(),
  manageManualDelivery: vi.fn(),
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
import { POST as editCycleSchedule } from "@/app/api/admin/delivery-cycles/route";
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
import { POST as bookDelivery } from "@/app/api/admin/external-deliveries/route";
import { POST as prepareShared } from "@/app/api/admin/shared-deliveries/route";
import { POST as confirmShared } from "@/app/api/admin/shared-deliveries/confirm/route";
import { POST as assignManualDelivery } from "@/app/api/admin/manual-deliveries/route";
import { GET as deliveryGet } from "@/app/api/admin/delivery/route";
import { GET as activityGet } from "@/app/api/admin/operations-activity/route";
import { GET as streamGet } from "@/app/api/admin/operational-stream/route";
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
  it("forwards the exact reviewed shared selection and authenticated context", async () => {
    coreMocks.prepareSharedDelivery.mockResolvedValue(ok);
    const body = {
      locationId: "location-1",
      jobs: [
        { jobId: "job-1", expectedVersion: 3 },
        { jobId: "job-2", expectedVersion: 2 },
      ],
      pickup: { kind: "IMMEDIATE" },
      optimize: true,
    };
    expect(
      (
        await prepareShared(
          command("https://app/api/admin/shared-deliveries", body, "shared-review"),
        )
      ).status,
    ).toBe(200);
    expect(coreMocks.prepareSharedDelivery).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...body,
        idempotencyKey: "shared-review",
        headers: expect.objectContaining(cookie),
      }),
    );
  });
  it("requires fit, a bounded selection and command identity before forwarding", async () => {
    expect(
      (
        await confirmShared(
          command("https://app/shared/confirm", {
            locationId: "location-1",
            bookingId: "booking-1",
            expectedVersion: 1,
            combinedLoadFits: false,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await prepareShared(
          command("https://app/shared", {
            locationId: "location-1",
            jobs: Array.from({ length: 6 }, (_, i) => ({ jobId: `job-${i}`, expectedVersion: 1 })),
            pickup: { kind: "IMMEDIATE" },
            optimize: false,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await confirmShared(
          new Request("https://app/shared/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              locationId: "location-1",
              bookingId: "booking-1",
              expectedVersion: 1,
              combinedLoadFits: true,
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(coreMocks.confirmSharedDelivery).not.toHaveBeenCalled();
    expect(coreMocks.prepareSharedDelivery).not.toHaveBeenCalled();
  });
  it("forwards confirmation without deciding provider success in Web", async () => {
    coreMocks.confirmSharedDelivery.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Await provider confirmation",
        requestId: "shared-request",
      },
    });
    const response = await confirmShared(
      command(
        "https://app/shared/confirm",
        {
          locationId: "location-1",
          bookingId: "booking-1",
          expectedVersion: 1,
          combinedLoadFits: true,
        },
        "shared-confirm",
      ),
    );
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(coreMocks.confirmSharedDelivery).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        bookingId: "booking-1",
        expectedVersion: 1,
        combinedLoadFits: true,
        idempotencyKey: "shared-confirm",
      }),
    );
  });
  it.each(["courier", "manual"])(
    "forwards a bounded late %s reason without deciding eligibility in Web",
    async (method) => {
      const route = method === "courier" ? bookDelivery : assignManualDelivery;
      const mock =
        method === "courier" ? coreMocks.requestExternalDelivery : coreMocks.manageManualDelivery;
      mock.mockResolvedValue(ok);
      const body = {
        locationId: "location-1",
        jobId: "job-1",
        expectedVersion: 1,
        lateDispatchReason: "  Packing ran late  ",
        ...(method === "courier"
          ? { providerCode: "lalamove", pickup: { kind: "IMMEDIATE" } }
          : { action: "ASSIGN", personName: "Rider", phoneE164: "+639171234567" }),
      };
      expect((await route(command("https://app/delivery", body))).status).toBe(200);
      expect(mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          ...body,
          lateDispatchReason: "Packing ran late",
          idempotencyKey: "command-1",
          headers: expect.objectContaining(cookie),
        }),
      );
      for (const reason of [" ", "x".repeat(1001), 123])
        expect(
          (await route(command("https://app/delivery", { ...body, lateDispatchReason: reason })))
            .status,
        ).toBe(400);
      expect(mock).toHaveBeenCalledOnce();
    },
  );
  it("forwards a complete schedule correction and rejects missing review versions or reasons", async () => {
    coreMocks.rescheduleAdminDeliveryCycle.mockResolvedValue(ok);
    const body = {
      action: "RESCHEDULE",
      cycleId: "cycle-1",
      marketId: "market-1",
      name: "Friday delivery",
      expectedVersion: 3,
      orderOpensAt: "2026-10-01T16:00:00Z",
      cutoffAt: "2026-10-08T16:00:00Z",
      procurementAt: "2026-10-08T18:00:00Z",
      preparationAt: "2026-10-09T05:00:00Z",
      pickupAt: "2026-10-09T06:00:00Z",
      windows: [
        { name: "Delivery", startsAt: "2026-10-09T07:00:00Z", endsAt: "2026-10-09T14:00:00Z" },
      ],
      participation: [{ zoneId: "zone-1", locationId: "location-1" }],
      reason: "Supplier delay",
    };
    const { action: _action, ...schedule } = body;
    expect((await editCycleSchedule(command("https://app/cycles", body))).status).toBe(200);
    expect(coreMocks.rescheduleAdminDeliveryCycle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...schedule,
        headers: expect.objectContaining(cookie),
        idempotencyKey: "command-1",
      }),
    );
    for (const invalid of [
      { ...body, expectedVersion: 0 },
      { ...body, reason: "" },
    ])
      expect((await editCycleSchedule(command("https://app/cycles", invalid))).status).toBe(400);
    expect(coreMocks.rescheduleAdminDeliveryCycle).toHaveBeenCalledOnce();
  });
  it("requires a WebSocket upgrade for the operational stream", () => {
    expect(streamGet().status).toBe(426);
  });

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
    coreMocks.listOperationalActivity.mockResolvedValue(ok);
    coreMocks.getGlobalCommerceConfiguration.mockResolvedValue(ok);
    coreMocks.listOperationalExceptions.mockResolvedValue(ok);

    await procurementGet(
      new Request("https://app/procurement?locationId=l1&cycleId=c1&limit=20", { headers: cookie }),
    );
    await receivingGet(
      new Request("https://app/receiving?locationId=l1&cursor=next", { headers: cookie }),
    );
    await fulfillmentGet(
      new Request("https://app/fulfillment?locationId=l1&cycleId=c1&filter=READY_FOR_DISPATCH", {
        headers: cookie,
      }),
    );
    await deliveryGet(new Request("https://app/delivery?locationId=l1", { headers: cookie }));
    await activityGet(new Request("https://app/activity?locationId=l1", { headers: cookie }));
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
      filter: "READY_FOR_DISPATCH",
    });
    expect(coreMocks.listDeliveryOperations.mock.calls[0][0]).toMatchObject({ locationId: "l1" });
    expect(coreMocks.listOperationalActivity.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
      headers: cookie,
    });
    expect(coreMocks.getGlobalCommerceConfiguration.mock.calls[0][0]).toMatchObject({
      headers: cookie,
    });
    expect(coreMocks.listOperationalExceptions.mock.calls[0][0]).toMatchObject({
      locationId: "l1",
    });
  });

  it("rejects an unknown fulfillment filter before Core", async () => {
    const response = await fulfillmentGet(
      new Request("https://app/fulfillment?locationId=l1&filter=UNKNOWN", { headers: cookie }),
    );
    expect(response.status).toBe(400);
    expect(coreMocks.listFulfillmentQueue).not.toHaveBeenCalled();
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
