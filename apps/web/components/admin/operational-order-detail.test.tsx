import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OperationalOrderDetail } from "./operational-order-detail";

describe("OperationalOrderDetail", () => {
  it("routes a Scheduled packing blocker to receiving without offering Finish packing", () => {
    const markup = renderToStaticMarkup(
      <OperationalOrderDetail
        item={{
          orderId: "order-scheduled",
          cycleId: "cycle-1",
          locationId: "location-1",
          status: "PACKING",
          version: 4,
          allowedActions: ["RECORD_SHORTAGE"],
          operational: {
            orderNumber: "FM-1002",
            committedAt: "2026-09-22T01:00:00.000Z",
            fulfillmentMode: "SCHEDULED",
            progress: "PREPARING",
            recipient: { name: "Ana", phone: "+639171110000" },
            timing: {
              cycleName: "Delivery week",
              windowName: null,
              startsAt: null,
              endsAt: null,
              pickupAt: null,
              timezone: null,
            },
            deliveryStatus: "UNASSIGNED",
            blockers: ["Goods for this delivery week are not fully recorded as received."],
            lines: [
              {
                lineId: "line-1",
                source: "ORIGINAL",
                productName: "Red onion",
                variantName: "500 g",
                unit: "pack",
                quantity: 1,
                baseQuantity: 500,
                baseUnit: "GRAM",
                goods: {
                  kind: "SCHEDULED_ALLOCATION",
                  status: "OPEN",
                  allocatedBase: 500,
                  receivedBase: null,
                },
              },
            ],
          },
        }}
        reason=""
        setReason={vi.fn()}
        pending={false}
        canManage={true}
        onAction={vi.fn()}
      />,
    );
    expect(markup).toContain("/admin/receiving?cycleId=cycle-1");
    expect(markup).toContain("Open receiving for this delivery week");
    expect(markup).toContain("Report shortage");
    expect(markup).toContain("Optional shortage reason");
    expect(markup).toContain("Describe the shortage (optional)");
    expect(markup).toContain("no receipt recorded");
    expect(markup).not.toContain("Finish packing");
  });

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
        canManage={true}
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

  it("keeps operational detail visible while hiding every mutation control for read-only staff", () => {
    const markup = renderToStaticMarkup(
      <OperationalOrderDetail
        item={{
          orderId: "order-read-only",
          cycleId: null,
          locationId: "location-1",
          status: "PICKING",
          version: 2,
          allowedActions: ["MARK_READY_TO_PACK", "RECORD_SHORTAGE"],
          operational: {
            orderNumber: "FM-1003",
            committedAt: "2026-09-22T01:00:00.000Z",
            fulfillmentMode: "INSTANT",
            progress: "PREPARING",
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
            blockers: [],
            lines: [
              {
                lineId: "line-1",
                source: "ORIGINAL",
                productName: "Red onion",
                variantName: "500 g",
                unit: "pack",
                quantity: 2,
                baseQuantity: 1000,
                baseUnit: "GRAM",
                goods: {
                  kind: "INSTANT_RESERVATION",
                  status: "RESERVED",
                  allocatedBase: 1000,
                  receivedBase: null,
                },
              },
            ],
          },
        }}
        reason=""
        setReason={vi.fn()}
        pending={false}
        canManage={false}
        onAction={vi.fn()}
      />,
    );
    expect(markup).toContain("Ordered item checklist");
    expect(markup).toContain("Finish picking");
    expect(markup).toContain("Reserved");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("Item shortage");
  });
});
