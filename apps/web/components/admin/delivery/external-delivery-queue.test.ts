import { describe, expect, it } from "vitest";
import { externalStatusLabel } from "./external-delivery-queue";

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
    [{ status: "CREATING", providerStatus: null }, "Booking Lalamove…"],
    [{ status: "RETRY_REQUIRED", providerStatus: null }, "Retrying Lalamove booking…"],
    [{ status: "OUTCOME_UNKNOWN", providerStatus: null }, "Awaiting provider confirmation"],
    [{ status: "FAILED", providerStatus: "FAILED" }, "Booking failed"],
    [{ status: "ACTIVE", providerStatus: "ALLOCATING" }, "Finding rider"],
    [{ status: "ACTIVE", providerStatus: "PENDING_PICKUP" }, "Rider assigned"],
    [{ status: "ACTIVE", providerStatus: "IN_DELIVERY" }, "Out for delivery"],
    [{ status: "COMPLETED", providerStatus: "COMPLETED" }, "Delivered"],
  ])("maps %o to %s", (change, expected) => {
    expect(externalStatusLabel({ ...dispatch, ...change })).toBe(expected);
  });
});
