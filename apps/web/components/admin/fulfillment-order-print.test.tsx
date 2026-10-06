// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOrderDetail } from "@freshmarkets/contracts";
import { FulfillmentOrderPrint } from "./fulfillment-order-print";
import { orderReceiptDocument } from "./order-receipt-document";

function order(id: string): AdminOrderDetail {
  return {
    orderId: id,
    orderNumber: `FM-${id}`,
    customerName: "Recipient",
    customerEmail: "recipient@example.com",
    fulfillmentMode: "INSTANT",
    status: "COMMITTED",
    totalMinor: 12500,
    currency: "PHP",
    paymentStatus: "SUCCEEDED",
    fulfillmentStatus: "NOT_STARTED",
    deliveryStatus: "UNASSIGNED",
    deliveryDispatchStatus: null,
    deliveryProviderStatus: null,
    committedAt: "2026-10-06T01:00:00.000Z",
    version: 1,
    allowedActions: [],
    customer: {
      name: "Recipient <script>unsafe()</script>",
      email: "recipient@example.com",
      phone: "Test phone",
      addressLines: ["Test street & building", "Cebu City"],
    },
    financial: {
      subtotalMinor: 10000,
      discountMinor: 500,
      deliveryFeeMinor: 3000,
      serviceFeeMinor: 0,
      taxMinor: 0,
      totalMinor: 12500,
      currency: "PHP",
      source: "CHECKOUT_QUOTE",
    },
    items: [
      {
        productName: "Tomato",
        variantName: "1 kg",
        unit: "pack",
        quantity: 2,
        baseQuantity: 2000,
        unitPriceMinor: 5000,
        lineTotalMinor: 10000,
      },
    ],
    payments: [],
    amendments: [],
    fulfillment: {
      locationId: "cebu",
      cycleId: null,
      zoneId: null,
      fulfillmentMode: "INSTANT",
      cutoffAt: null,
      deliveryDate: null,
      promisedAt: null,
      sourcingModes: [],
      status: "NOT_STARTED",
      version: 1,
      updatedAt: null,
    },
    delivery: null,
    exceptions: [],
    timeline: [],
    recentAudit: [],
  };
}
const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const props = {
  queueUrl: "/api/admin/fulfillment?locationId=cebu&filter=ALL&limit=50",
  locationId: "cebu",
  locationLabel: "Cebu",
  timezone: "Asia/Manila",
  disabled: false,
  onClear: vi.fn(),
};
async function open(ids = ["one", "two"]) {
  await act(async () => root.render(<FulfillmentOrderPrint {...props} orderIds={ids} />));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Print selected orders")!
      .click(),
  );
  await flush();
}

describe("Fulfillment order printing", () => {
  it("prints one/all selected receipts with immutable prices/address and safe text, omitting internal evidence", async () => {
    fetchMock.mockImplementation(async (url) =>
      response({
        ok: true,
        requestId: "print",
        value: String(url).startsWith("/api/admin/fulfillment")
          ? { items: [{ orderId: "one" }, { orderId: "two" }], nextCursor: null }
          : order(String(url).split("/").at(-1)!),
      }),
    );
    await open();
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Selected order receipts"]',
    )!;
    expect(iframe.srcdoc).toContain("FM-one");
    expect(iframe.srcdoc).toContain("FM-two");
    expect(iframe.srcdoc).toContain("Test street &amp; building");
    expect(iframe.srcdoc).toContain("2 pack");
    expect(iframe.srcdoc).toContain("125.00");
    expect(iframe.srcdoc).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(iframe.srcdoc).not.toContain("<script>");
    expect(iframe.srcdoc).not.toContain("recipient@example.com");
    const print = vi.spyOn(iframe.contentWindow!, "print").mockImplementation(() => undefined);
    vi.spyOn(iframe.contentWindow!, "focus").mockImplementation(() => undefined);
    await act(async () => iframe.dispatchEvent(new Event("load")));
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Print 2 orders")!
        .click(),
    );
    expect(print).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => init?.cache === "no-store" && (!init.method || init.method === "GET"),
      ),
    ).toBe(true);
  });
  it.each(["FORBIDDEN", "REFUNDED", "WRONG_LOCATION", "QUEUE_REMOVED", "NETWORK"])(
    "does not print a partial set when %s is encountered",
    async (failure) => {
      fetchMock.mockImplementation(async (url) => {
        if (String(url).startsWith("/api/admin/fulfillment"))
          return response({
            ok: true,
            requestId: "print",
            value: {
              items:
                failure === "QUEUE_REMOVED"
                  ? [{ orderId: "one" }]
                  : [{ orderId: "one" }, { orderId: "two" }],
            },
          });
        if (String(url).endsWith("two")) {
          if (failure === "NETWORK") throw new Error("Network unavailable");
          if (failure === "FORBIDDEN")
            return response({
              ok: false,
              error: { code: "FORBIDDEN", message: "Orders access denied", requestId: "print" },
            });
          const detail = order("two");
          if (failure === "REFUNDED")
            detail.payments = [
              {
                paymentIntentId: "payment",
                purpose: "GROCERY_CHECKOUT",
                status: "PARTIALLY_REFUNDED",
                amountMinor: 12500,
                refundedMinor: 1,
                currency: "PHP",
                createdAt: detail.committedAt!,
              },
            ];
          if (failure === "WRONG_LOCATION") detail.fulfillment!.locationId = "other";
          return response({ ok: true, requestId: "print", value: detail });
        }
        return response({ ok: true, requestId: "print", value: order("one") });
      });
      await open();
      expect(document.querySelector("iframe")).toBeNull();
      expect(document.body.textContent).toContain("Receipts could not be prepared");
      expect(
        [...document.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Print 2 orders",
        )?.disabled,
      ).toBe(true);
    },
  );
  it("invalidates receipts when the page's current selection changes", async () => {
    fetchMock.mockImplementation(async (url) =>
      response({
        ok: true,
        requestId: "print",
        value: String(url).includes("fulfillment?")
          ? { items: [{ orderId: "one" }, { orderId: "two" }] }
          : order(String(url).split("/").at(-1)!),
      }),
    );
    await open();
    await act(async () => root.render(<FulfillmentOrderPrint {...props} orderIds={["one"]} />));
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.body.textContent).toContain("The selection changed");
  });
  it("hides loaded financial receipts when access is removed", async () => {
    fetchMock.mockImplementation(async (url) =>
      response({
        ok: true,
        requestId: "print",
        value: String(url).includes("fulfillment?")
          ? { items: [{ orderId: "one" }] }
          : order("one"),
      }),
    );
    await open(["one"]);
    expect(document.querySelector("iframe")).not.toBeNull();
    await act(async () =>
      root.render(<FulfillmentOrderPrint {...props} disabled orderIds={["one"]} />),
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.body.textContent).not.toContain("Print order receipts");
  });
  it("does not treat a refunded uncommitted addition as a refund of paid Order goods", async () => {
    const detail = order("one");
    detail.payments = [
      {
        paymentIntentId: "uncommitted",
        purpose: "ORDER_AMENDMENT",
        status: "REFUNDED",
        amountMinor: 100,
        refundedMinor: 100,
        currency: "PHP",
        createdAt: detail.committedAt!,
      },
    ];
    fetchMock.mockImplementation(async (url) =>
      response({
        ok: true,
        requestId: "print",
        value: String(url).includes("fulfillment?") ? { items: [{ orderId: "one" }] } : detail,
      }),
    );
    await open(["one"]);
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Receipts could not be prepared");
  });
  it("retains unavailable breakdowns and committed addition totals without manufacturing an invoice", () => {
    const detail = order("legacy");
    detail.financial = {
      ...detail.financial,
      source: "ORDER_TOTAL_ONLY",
      subtotalMinor: null,
      discountMinor: null,
      deliveryFeeMinor: null,
      taxMinor: null,
    };
    detail.amendments = [
      {
        amendmentId: "addition",
        status: "COMMITTED",
        totalMinor: 10000,
        currency: "PHP",
        paymentIntentId: null,
        createdAt: detail.committedAt!,
        updatedAt: detail.committedAt!,
        lines: detail.items,
      },
      {
        amendmentId: "draft",
        status: "DRAFT",
        totalMinor: 1,
        currency: "PHP",
        paymentIntentId: null,
        createdAt: detail.committedAt!,
        updatedAt: detail.committedAt!,
        lines: [],
      },
    ];
    const html = orderReceiptDocument([detail, order("second")], "Cebu", "Asia/Manila");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Paid addition total");
    expect(html).not.toContain("Paid addition 2");
    expect(html).toContain("NOT AN OFFICIAL BIR INVOICE");
    expect(html).toContain("break-before: page");
    expect(html).toContain("table-header-group");
  });
});
