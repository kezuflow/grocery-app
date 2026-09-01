import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the bundled jsdom test runtime does not publish declarations.
import { JSDOM } from "jsdom";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

import { MockPaymentControls } from "@/app/development/mock-payments/[provider-reference]/mock-payment-controls";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://freshmarkets.ph/development/mock-payments/mock_pay_owned",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Event",
  "MouseEvent",
] as const)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name],
  });

describe("mock payment controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            ok: true,
            value: {
              outcome: "SUCCEEDED",
              processingStatus: "PROCESSED",
              paymentIntentId: "payment-intent-1",
              committedOrderId: "order-1",
            },
          }),
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("submits only a closed outcome and shows confirmed Core state", async () => {
    await act(async () => {
      root.render(<MockPaymentControls providerReference="mock_pay_owned" returnTo="/orders" />);
    });
    const approve = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Approve test payment"),
    );
    await act(async () => approve?.click());

    expect(fetch).toHaveBeenCalledWith(
      "/api/development/mock-payments/mock_pay_owned",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ outcome: "SUCCEEDED" }),
      }),
    );
    expect(container.textContent).toContain("Order confirmed");
    expect(container.querySelector('a[href="/orders/order-1"]')).not.toBeNull();
  });
});
