// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeliveryAddressDialog } from "./delivery-address-dialog";
import {
  rememberBrowsingPoint,
  BROWSING_LOCATION_COOKIE,
} from "../../../lib/storefront/browsing-location";
const mocks = vi.hoisted(() => ({ pathname: "/", refresh: vi.fn(), cart: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../storefront-runtime", () => ({
  useStorefrontRuntime: () => ({ mapboxPublicAccessToken: "" }),
}));
vi.mock("../../../lib/storefront/cart-client", () => ({ refreshCartForLocation: mocks.cart }));
// This boundary receives an already-confirmed selection. Provider confirmation
// is tested in AddressEditor; the dialog consumes only the display and point.
vi.mock("./address-editor", () => ({
  AddressEditor: ({
    onServiceabilityConfirmed,
  }: {
    onServiceabilityConfirmed: (value: {
      displayAddress: string;
      coordinate: { latitude: number; longitude: number };
    }) => void;
  }) => (
    <button
      onClick={() =>
        onServiceabilityConfirmed({
          displayAddress: "Test location",
          coordinate: { latitude: 10, longitude: 123 },
        })
      }
    >
      Confirm test choice
    </button>
  ),
}));
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.pathname = "/";
  mocks.refresh.mockClear();
  mocks.cart.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = `${BROWSING_LOCATION_COOKIE}=; Path=/; Max-Age=0`;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const render = async () => {
  await act(async () => root.render(<DeliveryAddressDialog />));
};
it.each(["close", "escape", "backdrop", "skip"])(
  "remembers %s dismissal across navigation",
  async (method) => {
    await render();
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    await act(async () => {
      if (method === "escape")
        dialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
      else if (method === "backdrop") dialog?.click();
      else if (method === "close")
        document.querySelector<HTMLButtonElement>('[aria-label="Close delivery address"]')?.click();
      else
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.startsWith("Skip for now"))
          ?.click();
    });
    expect(sessionStorage.getItem("freshmarkets.location-prompt-dismissed")).toBe("1");
    mocks.pathname = "/products/abiu";
    await render();
    expect(document.querySelector("dialog")).toBeNull();
  },
);
it.each([true, false])("refreshes only for a changed point (same=%s)", async (same) => {
  if (same) rememberBrowsingPoint({ latitude: 10, longitude: 123 });
  await render();
  if (same)
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Choose delivery address"]')?.click(),
    );
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Confirm test choice")
      ?.click(),
  );
  expect(mocks.refresh).toHaveBeenCalledTimes(same ? 0 : 1);
  expect(mocks.cart).toHaveBeenCalledTimes(same ? 0 : 1);
  expect(document.querySelector("dialog")).toBeNull();
});
