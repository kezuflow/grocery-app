// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeliveryAddressDialog } from "./delivery-address-dialog";
import {
  rememberBrowsingPoint,
  BROWSING_LOCATION_COOKIE,
} from "../../../lib/storefront/browsing-location";
const mocks = vi.hoisted(() => ({
  pathname: "/",
  refresh: vi.fn(),
  cart: vi.fn(),
  session: {
    data: null as { user: { id: string } } | null,
    isPending: false,
    error: null as { message: string } | null,
    refetch: vi.fn(),
  },
}));
vi.mock("../../../lib/auth/auth-client", () => ({
  authClient: { useSession: () => mocks.session },
}));
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
  mocks.session.data = null;
  mocks.session.isPending = false;
  mocks.session.error = null;
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
it.each(["escape", "backdrop"])("remembers %s dismissal across navigation", async (method) => {
  await render();
  const dialog = document.querySelector("dialog");
  expect(dialog).not.toBeNull();
  await act(async () => {
    if (method === "escape")
      dialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    else if (method === "backdrop") dialog?.click();
  });
  expect(sessionStorage.getItem("freshmarkets.location-prompt-dismissed")).toBe("1");
  mocks.pathname = "/products/abiu";
  await render();
  expect(document.querySelector("dialog")).toBeNull();
});
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

it.each(["guest", "pending", "error"])(
  "does not request private addresses for %s session",
  async (state) => {
    mocks.session.isPending = state === "pending";
    mocks.session.error = state === "error" ? { message: "Unavailable" } : null;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await render();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      state === "guest"
        ? "Sign in to see saved addresses"
        : state === "pending"
          ? "Loading saved addresses"
          : "We couldn’t load your account",
    );
  },
);
it("loads addresses for an authenticated session and handles session expiry", async () => {
  mocks.session.data = { user: { id: "test-user" } };
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 401 }));
  await render();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/commerce/address",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(document.body.textContent).toContain("Sign in to see saved addresses");
});

it.each(["success", "unavailable", "failure", "dismiss"])(
  "selects a saved address directly (%s)",
  async (outcome) => {
    mocks.session.data = { user: { id: "test-user" } };
    let finish: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          value: [
            {
              id: "saved-1",
              label: "Home",
              latitude: 10,
              longitude: 123,
              components: { addressLine1: "Test street", city: "Test city" },
            },
          ],
        }),
      )
      .mockReturnValueOnce(pending);
    await render();
    const button = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Home"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
      button?.click();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("/api/commerce/browsing-location");
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({
      coordinate: { latitude: 10, longitude: 123 },
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    if (outcome === "dismiss")
      await act(async () =>
        document
          .querySelector("dialog")
          ?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })),
      );
    await act(async () =>
      finish(
        Response.json(
          outcome === "failure"
            ? { ok: false }
            : {
                ok: true,
                value: {
                  coordinate: { latitude: 10, longitude: 123 },
                  displayAddress: "Test street",
                  serviceability: { serviceable: outcome !== "unavailable" },
                },
              },
          { status: outcome === "failure" ? 503 : 200 },
        ),
      ),
    );
    if (outcome === "success") {
      expect(document.querySelector("dialog")).toBeNull();
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      expect(mocks.cart).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(localStorage.getItem("freshmarkets.delivery-location.v2") ?? "null")
          .displayAddress,
      ).toBe("Test street");
    } else {
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(localStorage.getItem("freshmarkets.delivery-location.v2")).toBeNull();
      if (outcome !== "dismiss") expect(document.querySelector('[role="alert"]')).not.toBeNull();
      else expect(fetchSpy.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    }
  },
);
