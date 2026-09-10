// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductQuickView } from "./product-quick-view";

let root: Root;
let resolve: (response: Response) => void;
let reject: (error: Error) => void;
const close = vi.fn();
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  close.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    ),
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(slug: string | null) {
  await act(async () =>
    root.render(
      <ProductQuickView slug={slug} products={[]} onClose={close} onNavigate={() => {}} />,
    ),
  );
}
it("opens and offers a close button while the detail request is still pending", async () => {
  await render("abiu");
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Loading current options",
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Close product details"]')!.click(),
  );
  expect(close).toHaveBeenCalledOnce();
});
it("shows a visible error when the request fails", async () => {
  await render("abiu");
  await act(async () => reject(new Error("offline")));
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
});
it("does not reopen a closed dialog when an aborted request completes late", async () => {
  await render("abiu");
  await render(null);
  await act(async () => resolve(Response.json({ ok: false })));
  expect(document.querySelector("dialog")?.open).toBe(false);
});

it("ends a hung read and retries only when requested", async () => {
  vi.useFakeTimers();
  await render("abiu");
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
  expect(fetch).toHaveBeenCalledTimes(1);
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  expect(retry).toBeDefined();
  await act(async () => retry?.click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[aria-label="Loading product"]')).not.toBeNull();
  await act(async () => resolve(Response.json({ ok: false })));
});
