// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/app/(storefront)/orders/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
const item = (id: string) => ({
  id,
  orderNumber: id,
  status: "PAID",
  fulfillmentMode: "INSTANT",
  deliveryDate: null,
  promisedAt: null,
  committedAt: new Date(1000).toISOString(),
  totalMinor: 100,
  currency: "PHP",
  itemCount: 1,
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/orders");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  await act(async () => button.click());
}
describe("customer order history", () => {
  it("refreshes the order list only after the returned payment has an Order receipt", async () => {
    window.history.replaceState(null, "", "/orders?payment=return&paymentIntentId=payment-return");
    let orderReads = 0;
    const fetcher = vi.fn((input: string) => {
      if (input.startsWith("/api/checkout/payment/status"))
        return Promise.resolve(
          Response.json({
            ok: true,
            value: {
              paymentIntentId: "payment-return",
              state: "COMPLETED",
              orderId: "confirmed",
            },
          }),
        );
      orderReads += 1;
      return Promise.resolve(
        Response.json({
          ok: true,
          value: { items: orderReads === 1 ? [] : [item("confirmed")], nextCursor: null },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OrdersPage />));
    expect(container.textContent).toContain("Order confirmed");
    expect(container.querySelector('a[href="/orders/confirmed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="View order confirmed"]')).not.toBeNull();
    expect(orderReads).toBeGreaterThanOrEqual(2);
  });

  it("shows an incomplete checkout with a durable payment action", async () => {
    const pending = {
      paymentIntentId: "payment-pending",
      checkoutAttemptId: "quote-pending",
      state: "REQUIRES_ACTION",
      fulfillmentMode: "INSTANT",
      submittedAt: new Date(1000).toISOString(),
      totalMinor: 25000,
      currency: "PHP",
      itemCount: 3,
      action: {
        paymentIntentId: "payment-pending",
        state: "REQUIRES_ACTION",
        paymentMethod: { kind: "TOKEN", value: "qrph" },
        actionType: "REDIRECT",
        redirectUrl: "https://payments.example/continue",
        clientToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, value: { items: [], nextCursor: null } }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, value: { items: [pending], nextCursor: null } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OrdersPage />));
    await click("Needs payment");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/commerce/incomplete-checkouts");
    expect(container.textContent).toContain("Instant checkout");
    expect(container.textContent).toContain("3 items");
    expect(container.textContent).toContain("Continue payment");
  });

  it("pages unfinished checkouts and keeps the earlier results", async () => {
    const incomplete = (paymentIntentId: string) => ({
      paymentIntentId,
      checkoutAttemptId: `quote-${paymentIntentId}`,
      state: "PROCESSING",
      fulfillmentMode: "SCHEDULED",
      submittedAt: new Date(1000).toISOString(),
      totalMinor: 25000,
      currency: "PHP",
      itemCount: 1,
      action: {
        paymentIntentId,
        state: "PROCESSING",
        paymentMethod: null,
        actionType: "NONE",
        redirectUrl: null,
        clientToken: null,
        expiresAt: null,
      },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, value: { items: [], nextCursor: null } }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: { items: [incomplete("payment-1")], nextCursor: "next-incomplete" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: { items: [incomplete("payment-2")], nextCursor: null },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OrdersPage />));
    await click("Needs payment");
    await click("Load more checkouts");
    expect(fetcher.mock.calls[2]?.[0]).toContain("cursor=next-incomplete");
    expect(container.querySelectorAll("article")).toHaveLength(2);
  });

  it("loads more orders and restarts pagination when the server-side filter changes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, value: { items: [item("first")], nextCursor: "cursor-one" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ ok: true, value: { items: [item("second")], nextCursor: null } }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, value: { items: [], nextCursor: null } }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<OrdersPage />));
    await click("Load more orders");
    expect(container.querySelector('[aria-label="View order second"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="View order first"]')).not.toBeNull();
    expect(fetcher.mock.calls[1]?.[0]).toContain("cursor=cursor-one");
    await click("Completed");
    expect(fetcher.mock.calls[2]?.[0]).toBe("/api/commerce/orders?filter=completed");
    expect(container.textContent).toContain("No orders in this view yet.");
  });
  it("shows a retryable failure instead of pretending the history is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(
          Response.json({ ok: true, value: { items: [item("recovered")], nextCursor: null } }),
        ),
    );
    await act(async () => root.render(<OrdersPage />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Orders could not be loaded",
    );
    expect(container.textContent).not.toContain("No orders in this view yet.");
    await click("Try again");
    expect(container.querySelector('[aria-label="View order recovered"]')).not.toBeNull();
  });
});
