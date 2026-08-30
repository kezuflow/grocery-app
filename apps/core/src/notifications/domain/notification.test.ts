import { describe, expect, it } from "vitest";
import { notificationTypes, retryDelayMs, validateNotification } from "./notification";

describe("notification policy", () => {
  it("closes the launch type vocabulary and rejects unsafe payloads", () => {
    expect(notificationTypes).toHaveLength(11);
    expect(
      validateNotification({
        type: "ORDER_CONFIRMED",
        recipient: "c@example.com",
        templateData: { orderNumber: "FM-1" },
      }).ok,
    ).toBe(true);
    expect(
      validateNotification({ type: "CUSTOM", recipient: "c@example.com", templateData: {} }).ok,
    ).toBe(false);
    expect(
      validateNotification({
        type: "ORDER_CONFIRMED",
        recipient: "c@example.com",
        templateData: { url: "https://x?token=secret" },
      }).ok,
    ).toBe(false);
  });
  it("bounds exponential retry delay", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
