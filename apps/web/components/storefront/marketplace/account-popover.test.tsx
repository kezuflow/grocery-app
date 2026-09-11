// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountPopover } from "./account-popover";

const session = vi.hoisted(() => ({
  data: null as null | { user: { name: string } },
  isPending: false,
  error: null as null | Error,
  refetch: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../../lib/auth/auth-client", () => ({
  authClient: { useSession: () => session, signOut: session.signOut },
}));
let root: Root;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(session, { data: null, isPending: false, error: null });
  session.refetch.mockClear();
  session.signOut.mockReset();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
async function open() {
  await act(async () => root.render(<AccountPopover />));
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
}
it("opens without navigation, offers guest sign-in, and restores focus when closed", async () => {
  await open();
  expect(document.querySelector('a[href="/auth/login?returnTo=/account"]')).not.toBeNull();
  expect(document.querySelector('a[href="/auth/logout"]')).toBeNull();
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe("Account");
});
it("shows the authenticated profile and opens sign-out confirmation without signing out", async () => {
  session.data = { user: { name: "Test Shopper" } };
  await open();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Test Shopper");
  const signOut = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Sign out",
  );
  expect(signOut).toBeDefined();
  await act(async () => signOut?.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sign out?");
  expect(session.signOut).not.toHaveBeenCalled();
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  await act(async () => cancel?.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(session.signOut).not.toHaveBeenCalled();
  expect(document.querySelector('a[href="/auth/login?returnTo=/account"]')).toBeNull();
});
it("does not present a failed session request as signed out and allows retry", async () => {
  session.error = new Error("offline");
  await open();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector('a[href="/auth/login?returnTo=/account"]')).toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
  );
  expect(session.refetch).toHaveBeenCalledOnce();
});
it("announces loading without showing stale identity actions", async () => {
  session.isPending = true;
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading");
  expect(document.querySelector('a[href="/auth/logout"]')).toBeNull();
});

it("keeps sign-out failure in the modal for retry", async () => {
  session.data = { user: { name: "Test Shopper" } };
  session.signOut.mockResolvedValue({ error: { message: "Offline" } });
  await open();
  const clickSignOut = async () =>
    act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Sign out")
        ?.click(),
    );
  await clickSignOut();
  expect(session.signOut).not.toHaveBeenCalled();
  await clickSignOut();
  expect(session.signOut).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t sign out");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
