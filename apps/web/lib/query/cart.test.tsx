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

function DraftProbe({ cartId = "cart-1", label = "draft" }: { cartId?: string; label?: string }) {
  const draft = useCheckoutDraft(cartId);
  return (
    <div data-label={label}>
      <span>
        {label}:{draft.draft.addressId || "empty"}:{draft.draft.promotionCodes.join(",")}
      </span>
      <button
        onClick={() => {
          draft.patchAddress("address-1");
          draft.setPromotionCodes(["save10"]);
        }}
      >
        Set {label}
      </button>
      <button onClick={draft.clearPromotions}>Clear {label}</button>
    </div>
  );
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.sessionStorage.clear();
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
  expect(host.textContent).toContain("draft:address-1:SAVE10");
  expect(
    client.getQueryCache().findAll({ queryKey: ["private", 0, "checkout-draft"] }),
  ).toHaveLength(1);
});

it("reactively shares promotion and address patches across mounted Cart surfaces", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = createQueryClient();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <DraftProbe label="drawer" />
        <DraftProbe label="page" />
      </QueryClientProvider>,
    ),
  );
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Set drawer")
      ?.click(),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(host.textContent).toContain("drawer:address-1:SAVE10");
  expect(host.textContent).toContain("page:address-1:SAVE10");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Clear page")
      ?.click(),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(host.textContent).toContain("drawer:address-1:");
  expect(host.textContent).toContain("page:address-1:");
});

it("clears promotion intent for a successor Cart while preserving the selected address", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = createQueryClient();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <DraftProbe cartId="cart-1" />
      </QueryClientProvider>,
    ),
  );
  await act(async () => host.querySelector("button")?.click());
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <DraftProbe cartId="cart-2" />
      </QueryClientProvider>,
    ),
  );
  expect(host.textContent).toContain("draft:address-1:");
  expect(host.textContent).not.toContain("SAVE10");
});

it("carries non-sensitive guest promotion intent through the sign-in Cart handoff once", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const guestClient = createQueryClient();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={guestClient}>
        <DraftProbe cartId="guest-cart" />
      </QueryClientProvider>,
    ),
  );
  await act(async () => host.querySelector("button")?.click());
  act(() => root!.unmount());
  root = createRoot(host);
  const signedInClient = createQueryClient();
  await act(async () =>
    root!.render(
      <QueryClientProvider client={signedInClient}>
        <DraftProbe cartId="server-cart" />
      </QueryClientProvider>,
    ),
  );
  expect(host.textContent).toContain("draft:empty:SAVE10");
  expect(window.sessionStorage.length).toBe(0);
});
