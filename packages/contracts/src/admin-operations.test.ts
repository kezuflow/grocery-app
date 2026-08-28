import { describe, expect, it } from "vitest";
import {
  adminOperationsReadCapabilities,
  type DeliveryOperationsSummary,
  type FulfillmentModeConfigurationView,
  type FulfillmentQueueView,
  type OperationalExceptionPage,
  type ProcurementRequirementView,
  type ReceivingSessionView,
} from "./admin-operations";

describe("admin operations contracts", () => {
  it("publishes the closed capabilities for location-scoped operational reads", () => {
    expect(adminOperationsReadCapabilities).toEqual([
      "procurement.read",
      "receiving.manage",
      "fulfillment.read",
      "delivery.read",
      "fulfillment.manage",
    ]);
  });

  it("keeps operations payloads purpose-built with integer quantities and versions", () => {
    void ({
      locationId: "location-cebu-central",
      activeMode: "INSTANT",
      cadence: null,
      promiseMinutes: 90,
      maxConcurrentInstantOrders: 12,
      version: 3,
    } satisfies FulfillmentModeConfigurationView);
    void ({
      requirementId: "requirement-1",
      cycleId: "cycle-1",
      locationId: "location-cebu-central",
      inventoryPoolId: "pool-1",
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
      allowedActions: ["PACK"],
    } satisfies FulfillmentQueueView);
    void ({
      locationId: "location-cebu-central",
      cycleId: "cycle-1",
      status: "OPEN",
      totalOpenJobs: 2,
      assignedJobs: 1,
      items: [],
    } satisfies DeliveryOperationsSummary);
    void ({ items: [], nextCursor: null } satisfies OperationalExceptionPage);
  });
});
