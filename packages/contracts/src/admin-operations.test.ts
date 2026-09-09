import { describe, expect, it } from "vitest";
import {
  adminOperationsReadCapabilities,
  fulfillmentActions,
  fulfillmentStatuses,
  deliveryActions,
  deliveryStatuses,
  type DeliveryOperationsSummary,
  type AdminDeliveryOperationView,
  type GlobalCommerceConfigurationView,
  type FulfillmentQueueView,
  type OperationalExceptionPage,
  type ProcurementRequirementView,
  type ReceivingSessionView,
} from "./admin-operations";

describe("admin operations contracts", () => {
  it("publishes the closed capabilities for location-scoped operational reads", () => {
    expect(adminOperationsReadCapabilities).toEqual([
      "procurement.read",
      "procurement.manage",
      "fulfillment.read",
      "delivery.read",
      "fulfillment.manage",
    ]);
  });

  it("publishes canonical fulfillment and delivery vocabularies", () => {
    expect(fulfillmentStatuses).toEqual([
      "NOT_STARTED",
      "PICKING",
      "READY_TO_PACK",
      "PACKING",
      "PACKED",
      "HANDED_OFF",
      "COMPLETED",
      "SHORTED",
      "CANCELED",
      "ESCALATED",
    ]);
    expect(fulfillmentActions).toEqual([
      "START_PICKING",
      "MARK_READY_TO_PACK",
      "START_PACKING",
      "MARK_PACKED",
      "HAND_OFF",
      "COMPLETE",
      "RECORD_SHORTAGE",
      "RESUME_PICKING",
      "RESUME_READY_TO_PACK",
      "CANCEL",
      "ESCALATE",
    ]);
    expect(deliveryStatuses).toEqual([
      "UNASSIGNED",
      "ASSIGNED",
      "EN_ROUTE",
      "ARRIVED",
      "DELIVERED",
      "FAILED",
      "RETRY_SCHEDULED",
      "ESCALATED",
      "CANCELED",
    ]);
    expect(deliveryActions).toEqual([
      "MARK_EN_ROUTE",
      "MARK_ARRIVED",
      "MARK_DELIVERED",
      "MARK_FAILED",
      "SCHEDULE_RETRY",
      "ESCALATE",
      "CANCEL",
    ]);
  });

  it("keeps operations payloads purpose-built with integer quantities and versions", () => {
    void ({
      sellingState: "OPEN",
      fulfillmentMode: "INSTANT",
      cadence: null,
      version: 3,
      readinessBlockers: [],
    } satisfies GlobalCommerceConfigurationView);
    void ({
      requirementId: "requirement-1",
      cycleId: "cycle-1",
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-1",
      skuId: "sku-1",
      committedQuantitySellable: 2,
      shippingWeightGrams: 1250,
      requiredQuantityBase: 1250,
      acceptedBase: 500,
      rejectedBase: 50,
      status: "ORDERED",
      version: 4,
    } satisfies ProcurementRequirementView);
    void ({
      receivingSessionId: "receipt-1",
      requirementId: "requirement-1",
      cycleId: "cycle-1",
      locationId: "location-cebu-central",
      expectedBase: 1250,
      acceptedBase: 500,
      rejectedBase: 50,
      status: "IN_PROGRESS",
      version: 2,
    } satisfies ReceivingSessionView);
    void ({
      orderId: "order-1",
      cycleId: "cycle-1",
      locationId: "location-cebu-central",
      status: "PICKING",
      version: 5,
      allowedActions: ["MARK_READY_TO_PACK", "RECORD_SHORTAGE"],
    } satisfies FulfillmentQueueView);
    void ({
      locationId: "location-cebu-central",
      cycleId: "cycle-1",
      status: "OPEN",
      totalOpenJobs: 2,
      bookedJobs: 1,
      items: [],
      nextCursor: "cursor-1",
    } satisfies DeliveryOperationsSummary);
    void ({
      jobId: "job-1",
      orderId: "order-1",
      cycleId: "cycle-1",
      locationId: "location-cebu-central",
      fulfillmentMode: "SCHEDULED",
      status: "UNASSIGNED",
      externalDispatch: null,
      manualDelivery: null,
      manualActions: [],
      canRevisePromise: false,
      canInspectReturnedGoods: false,
      courierPickup: { allowedKinds: [], unavailableReason: null },
      deliveredAtIso: null,
      version: 1,
    } satisfies AdminDeliveryOperationView);
    void ({ items: [], nextCursor: null } satisfies OperationalExceptionPage);
  });
});
