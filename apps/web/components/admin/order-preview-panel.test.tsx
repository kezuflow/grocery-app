// @vitest-environment jsdom
import type { AdminOrderDetail } from "@freshmarkets/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPreviewPanel } from "./order-preview-panel";

vi.mock("../../app/admin/admin-context-provider", () => ({
  useAdminContext: () => ({
    state: { phase: "ready", selectedScope: { kind: "GLOBAL" }, context: { capabilities: [] } },
  }),
  useAdminScopeGuard: () => undefined,
}));

const detail: AdminOrderDetail = {
  orderId: "order-1",
  orderNumber: "FM-1001",
  customerName: "Alex Cruz",
  customerEmail: "alex@example.test",
  fulfillmentMode: "INSTANT",
  status: "COMMITTED",
  totalMinor: 15_000,
  currency: "PHP",
  paymentStatus: "SUCCEEDED",
  fulfillmentStatus: "NOT_STARTED",
  deliveryStatus: null,
  deliveryDispatchStatus: null,
  deliveryProviderStatus: null,
  committedAt: "2026-09-21T08:00:00.000Z",
  version: 3,
  allowedActions: ["CANCEL"],
  customer: {
    name: "Alex Cruz",
    email: "alex@example.test",
    phone: null,
    addressLines: ["Cebu City"],
  },
  financial: {
    subtotalMinor: 15_000,
    discountMinor: 0,
    deliveryFeeMinor: 0,
    serviceFeeMinor: 0,
    taxMinor: 0,
    totalMinor: 15_000,
    currency: "PHP",
    source: "CHECKOUT_QUOTE",
  },
  items: [
    {
      productName: "Carrots",
      variantName: "1 kg",
      unit: "GRAM",
      quantity: 2,
      baseQuantity: 2_000,
      unitPriceMinor: 7_500,
      lineTotalMinor: 15_000,
    },
  ],
  payments: [],
  amendments: [],
  fulfillment: null,
  delivery: null,
  exceptions: [],
  timeline: [],
  recentAudit: [],
};

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onUpdated = vi.fn();

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock.mockReset();
  onUpdated.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("OrderPreviewPanel", () => {
  it("loads authoritative detail and renders the selected order's items and status control", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, requestId: "req-1", value: detail }));

    await act(async () => {
      root.render(<OrderPreviewPanel order={detail} onClose={() => {}} onUpdated={onUpdated} />);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/orders/order-1", {
      signal: expect.any(AbortSignal),
      cache: "no-store",
    });
    expect(host.textContent).toContain("Order Preview");
    expect(host.textContent).toContain("Ordered items");
    expect(host.textContent).toContain("Carrots");
    expect(host.textContent).toContain("₱75.00");
    expect(host.querySelector('table[aria-label="Ordered items for FM-1001"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Order status"]')).not.toBeNull();
    expect(onUpdated).toHaveBeenCalledWith(detail);
  });

  it("refreshes an open preview on focus and drops actions revoked by current Core state", async () => {
    const manageable: AdminOrderDetail = {
      ...detail,
      allowedActions: ["CANCEL", "OVERRIDE_STATUS"],
    };
    const delivered: AdminOrderDetail = {
      ...detail,
      status: "DELIVERED",
      version: detail.version + 1,
      allowedActions: [],
    };
    fetchMock
      .mockResolvedValueOnce(Response.json({ ok: true, value: manageable }))
      .mockResolvedValueOnce(Response.json({ ok: true, value: delivered }));
    await act(async () => {
      root.render(<OrderPreviewPanel order={detail} onClose={() => {}} onUpdated={onUpdated} />);
    });
    expect(host.textContent).toContain("Committed");
    expect(host.querySelector('[aria-label="Override Order status"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("Delivered");
    expect(host.textContent).not.toContain("Canceled");
    expect(host.querySelector('[aria-label="Override Order status"]')).toBeNull();
    expect(onUpdated).toHaveBeenLastCalledWith(delivered);
  });
});
