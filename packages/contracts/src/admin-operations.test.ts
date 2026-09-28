import { expect, it } from "vitest";
import {
  adminOperationsReadCapabilities,
  fulfillmentActions,
  fulfillmentStatuses,
  deliveryActions,
  deliveryStatuses,
  fulfillmentQueueFilters,
} from "./admin-operations";

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
    "COMPLETE_SCHEDULED_PACKING",
    "RECORD_SHORTAGE",
    "RESUME_PICKING",
    "RESUME_READY_TO_PACK",
    "ESCALATE",
  ]);
  expect(fulfillmentQueueFilters).toEqual([
    "ALL",
    "ACTIVE",
    "NEW",
    "PREPARING",
    "READY_FOR_DISPATCH",
    "UPCOMING",
    "HISTORY",
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
