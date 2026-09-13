// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { CartView } from "@freshmarkets/contracts";
import { createQueryClient } from "./query-client";

const load = vi.hoisted(() => vi.fn());
vi.mock("../storefront/cart-client", () => ({
  CART_CHANGED_EVENT: "fm:cart-changed",
  cartLoadError: () => "",
  fetchCart: load,
}));
import { useCartQuery, useCheckoutDraft } from "./cart";

const initial: CartView = {
  id: "cart-1",
  version: 1,
  currency: "PHP",
  items: [],
  totalMinor: 0,
  checkoutBlocked: false,
  blockingReasons: [],
};

function Consumer({ label }: { label: string }) {
  const { cart } = useCartQuery();
  return (
    <p>
      {label}:{cart?.version ?? "loading"}
    </p>
  );
}

function DraftProbe() {
  const draft = useCheckoutDraft();
  return (
    <button onClick={() => draft.save({ addressId: "address-1", promotionCodes: ["SAVE10"] })}>
      {draft.initial.addressId || "empty"}:{draft.initial.promotionCodes.join(",")}
    </button>
  );
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  load.mockReset();
});

it("deduplicates cart owners and accepts the exact successful command view", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  load.mockResolvedValue(initial);
  const client = createQueryClient();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <Consumer label="drawer" />
        <Consumer label="badge" />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("drawer:1");
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent("fm:cart-changed", {
        detail: { view: { ...initial, version: 2 } },
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(host.textContent).toContain("drawer:2");
  expect(host.textContent).toContain("badge:2");
});

it("keeps safe checkout inputs across an ordinary remount in the private epoch cache", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = createQueryClient();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <DraftProbe />
      </QueryClientProvider>,
    ),
  );
  await act(async () => host.querySelector("button")!.click());
  act(() => root!.unmount());
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <DraftProbe />
      </QueryClientProvider>,
    ),
  );
  expect(host.textContent).toBe("address-1:SAVE10");
  expect(
    client.getQueryCache().findAll({ queryKey: ["private", 0, "checkout-draft"] }),
  ).toHaveLength(1);
});
