import { describe, expect, it } from "vitest";
import { deliveryJobStatusLabel, externalStatusLabel } from "./external-delivery-queue";

const dispatch = {
  dispatchId: "dispatch-1",
  provider: "lalamove" as const,
  status: "ACTIVE",
  providerStatus: "ALLOCATING",
  trackingUrl: null,
  providerDeliveryId: "provider-1",
  version: 1,
};

describe("external delivery status labels", () => {
  it.each([
    [{ status: "CREATING", providerStatus: null }, "Booking in progress…"],
    [{ status: "RETRY_REQUIRED", providerStatus: null }, "Booking retry required"],
    [{ status: "OUTCOME_UNKNOWN", providerStatus: null }, "Awaiting provider confirmation"],
    [{ status: "FAILED", providerStatus: "FAILED", providerDeliveryId: null }, "Booking failed"],
    [
      { status: "FAILED", providerStatus: "FAILED", providerDeliveryId: "provider-1" },
      "Delivery failed",
    ],
    [{ status: "CANCELED", providerStatus: "CANCELED" }, "Delivery canceled"],
    [{ status: "ACTIVE", providerStatus: "ALLOCATING" }, "Finding rider"],
    [{ status: "ACTIVE", providerStatus: "PENDING_PICKUP" }, "Rider assigned"],
    [{ status: "ACTIVE", providerStatus: "IN_DELIVERY" }, "Out for delivery"],
    [{ status: "COMPLETED", providerStatus: "COMPLETED" }, "Delivered"],
  ])("maps %o to %s", (change, expected) => {
    expect(externalStatusLabel({ ...dispatch, ...change })).toBe(expected);
  });
});

describe("delivery job status labels", () => {
  it.each([
    ["UNASSIGNED", "Awaiting assignment"],
    ["ASSIGNED", "Assigned"],
    ["EN_ROUTE", "Out for delivery"],
    ["FAILED", "Delivery failed"],
    ["RETRY_SCHEDULED", "Retry scheduled"],
    ["DELIVERED", "Delivered"],
  ])("labels %s as %s", (status, label) => {
    expect(deliveryJobStatusLabel(status)).toBe(label);
  });
});
