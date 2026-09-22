import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OperationalOrderDetail } from "./operational-order-detail";

describe("OperationalOrderDetail", () => {
  it("shows the location-safe paid snapshot and automatic Instant dispatch without finance fields", () => {
    const markup = renderToStaticMarkup(
      <OperationalOrderDetail
        item={{
          orderId: "order-1",
          cycleId: null,
          locationId: "location-1",
          status: "PACKED",
          version: 3,
          allowedActions: [],
          operational: {
            orderNumber: "FM-1001",
            committedAt: "2026-09-22T01:00:00.000Z",
            fulfillmentMode: "INSTANT",
            progress: "READY_FOR_DISPATCH",
            recipient: { name: "Ana", phone: "+639171110000" },
            timing: {
              cycleName: null,
              windowName: null,
              startsAt: null,
              endsAt: null,
              pickupAt: null,
              timezone: null,
            },
            deliveryStatus: "UNASSIGNED",
            deliveryExecution: {
              method: "EXTERNAL",
              status: "ACTIVE",
              providerStatus: "ALLOCATING",
            },
            blockers: [],
            lines: [
              {
                lineId: "line-1",
                source: "COMMITTED_ADDITION",
                productName: "Tomato",
                variantName: "Roma",
                unit: "kg",
                quantity: 2,
                baseQuantity: 2000,
                baseUnit: "GRAM",
                goods: {
                  kind: "INSTANT_RESERVATION",
                  status: "RESERVED",
                  allocatedBase: 2000,
                  receivedBase: null,
                },
              },
            ],
          },
        }}
        reason=""
        setReason={vi.fn()}
        pending={false}
        onAction={vi.fn()}
      />,
    );
    expect(markup).toContain("FM-1001");
    expect(markup).toContain("Paid addition");
    expect(markup).toContain("Reserved");
    expect(markup).toContain("Finding rider");
    expect(markup).toContain("View Lalamove delivery");
    expect(markup).not.toContain("Payment");
    expect(markup).not.toContain("₱");
  });
});
