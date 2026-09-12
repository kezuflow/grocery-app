// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerNotifications } from "./customer-notifications";

const session = vi.hoisted(() => ({
  data: null as null | { user: { id: string } },
  isPending: false,
  error: null as null | Error,
  refetch: vi.fn(),
}));
vi.mock("../../../lib/auth/auth-client", () => ({ authClient: { useSession: () => session } }));
let root: Root;
const fetchMock = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(session, { data: null, isPending: false, error: null });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function open() {
  await act(async () => root.render(<CustomerNotifications />));
  await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
}
const success = (items: unknown[] = []) => ({
  json: async () => ({ ok: true, value: { items, hasMore: false } }),
});
it("shows a signed-out entry without requesting private data and restores focus after Escape", async () => {
  await open();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.querySelector('a[href="/auth/login?returnTo=/orders"]')).not.toBeNull();
  expect(document.activeElement).toBe(document.querySelector("h2"));
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Open notifications"),
  );
});
it("does not confuse failed authentication with a signed-out account", async () => {
  session.error = new Error("offline");
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("account");
  expect(document.querySelector('a[href*="login"]')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps focus inside a rapidly reopened panel", async () => {
  await open();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Open notifications"]')?.click(),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector("h2")));
});
it("announces loading and empty state without fake unread semantics", async () => {
  session.data = { user: { id: "shopper" } };
  let finish: ((value: ReturnType<typeof success>) => void) | undefined;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading notifications");
  await act(async () => finish?.(success()));
  expect(document.querySelector('[role="status"]')?.textContent).toContain("No updates yet");
  expect(document.body.textContent).not.toMatch(/unread|mark.*read/i);
});
it("renders title-only safe destinations, retries failures, and closes after selection", async () => {
  session.data = { user: { id: "shopper" } };
  fetchMock.mockRejectedValueOnce(new Error("network"));
  await open();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  fetchMock.mockResolvedValueOnce(
    success([
      {
        type: "ORDER_REFUND_EXCEPTION",
        label: "Refund needs support",
        reference: "FM-1",
        occurredAt: "2026-09-13T00:00:00.000Z",
        href: "mailto:support@freshmarkets.ph",
        actionLabel: "Contact support",
      },
    ]),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click(),
  );
  expect(document.querySelector("time")).toBeNull();
  expect(document.querySelector('[aria-label="Close notifications"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Recent order and payment updates");
  expect(document.body.textContent).not.toContain("FM-1");
  expect(document.querySelector('a[href="mailto:support@freshmarkets.ph"]')?.textContent).toContain(
    "Refund needs support",
  );
  expect(document.body.textContent).not.toContain("Contact support");
  expect(
    document.querySelector('a[href="mailto:support@freshmarkets.ph"]')?.getAttribute("aria-label"),
  ).toContain("FM-1");
  await act(async () => document.querySelector<HTMLAnchorElement>('a[href="/orders"]')?.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("discards late results after dismissal and fetches again on reopening", async () => {
  session.data = { user: { id: "shopper" } };
  let finish: ((value: ReturnType<typeof success>) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () => finish?.(success()));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  fetchMock.mockResolvedValueOnce(success());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Open notifications"]')?.click(),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("shows unavailable account access without exposing internal errors", async () => {
  session.data = { user: { id: "shopper" } };
  fetchMock.mockResolvedValueOnce({
    json: async () => ({
      ok: false,
      error: { code: "FORBIDDEN", message: "PRIVATE INTERNAL REASON", requestId: "test" },
    }),
  });
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "unavailable for this account",
  );
  expect(document.body.textContent).not.toContain("PRIVATE");
});

it("discards an old customer's late result when the session identity changes", async () => {
  session.data = { user: { id: "first-shopper" } };
  let finish: ((value: ReturnType<typeof success>) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  session.data = { user: { id: "second-shopper" } };
  fetchMock.mockResolvedValueOnce(success());
  await act(async () => root.render(<CustomerNotifications />));
  await act(async () =>
    finish?.(
      success([
        {
          type: "DELIVERED",
          label: "Old private notice",
          reference: "Old order",
          occurredAt: "2026-09-13T00:00:00.000Z",
          href: "/orders/old",
          actionLabel: "View order",
        },
      ]),
    ),
  );
  expect(document.body.textContent).toContain("No updates yet");
  expect(document.body.textContent).not.toContain("Old private notice");
});
