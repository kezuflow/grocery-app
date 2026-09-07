// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/app/orders/page";

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
