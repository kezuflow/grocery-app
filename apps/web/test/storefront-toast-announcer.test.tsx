// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ToastAnnouncer } from "../components/storefront/marketplace/toast-announcer";
import { announceToast } from "../lib/storefront/cart-client";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ToastAnnouncer />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

it("maps storefront success and failure events to Sonner", () => {
  act(() => announceToast({ tone: "success", message: "Added to cart" }));
  act(() => announceToast({ tone: "error", message: "Could not add item" }));

  expect(toast.success).toHaveBeenCalledOnce();
  expect(toast.success).toHaveBeenCalledWith(
    "Added to cart",
    expect.objectContaining({ duration: 4_200 }),
  );
  expect(toast.error).toHaveBeenCalledOnce();
  expect(toast.error).toHaveBeenCalledWith(
    "Could not add item",
    expect.objectContaining({ duration: 4_200 }),
  );
});
