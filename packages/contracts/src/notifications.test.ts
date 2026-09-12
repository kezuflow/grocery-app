import { describe, expect, it } from "vitest";
import { customerNotificationTypes, type CustomerNotification, type OrdersService } from "./index";

describe("customer notification contracts", () => {
  it("restricts the surface to the twelve approved transaction events", () => {
    expect(customerNotificationTypes).toHaveLength(12);
    expect(new Set(customerNotificationTypes).size).toBe(12);
    expect(customerNotificationTypes).not.toContain("STAFF_INVITED");
    expect(customerNotificationTypes).not.toContain("RENEWAL_ACTION_REQUIRED");
  });
});

function customerBoundary(service: OrdersService) {
  // @ts-expect-error A caller-selected customer is never read authority.
  void service.listCustomerNotifications({ requestId: "test", headers: {}, customerId: "other" });
  const notice: CustomerNotification = {
    type: "DELIVERED",
    label: "Delivered",
    reference: "FM-1",
    occurredAt: "2026-09-13T00:00:00.000Z",
    href: "/orders/example",
    actionLabel: "View order",
    // @ts-expect-error Delivery internals do not cross this customer boundary.
    recipient: "private@example.com",
  };
  return notice;
}
void customerBoundary;
