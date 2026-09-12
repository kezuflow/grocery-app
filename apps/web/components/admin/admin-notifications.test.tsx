// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminContextState } from "../../app/admin/admin-context-provider";
import type { AdminOverviewView, RpcResult } from "@freshmarkets/contracts";
import { AdminNotifications } from "./admin-notifications";

const fixture = vi.hoisted(() => ({
  state: { phase: "loading" } as AdminContextState,
  result: null as RpcResult<AdminOverviewView> | null,
  selectScope: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../app/admin/admin-context-provider", () => ({ useAdminContext: () => fixture }));
vi.mock("../../app/admin/admin-overview-provider", () => ({ useAdminOverview: () => fixture }));
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(fixture, { state: { phase: "loading" }, result: null });
  fixture.selectScope.mockClear();
  fixture.refresh.mockClear();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
async function open() {
  await act(async () => root.render(<AdminNotifications />));
  await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
}
function ready() {
  fixture.state = {
    phase: "ready",
    context: {
      staffId: "staff",
      displayName: "Staff",
      email: "staff@example.com",
      navigation: [],
      environment: "test",
      capabilities: [],
      scopes: [],
    },
    scopes: [],
    selectedScope: { kind: "GLOBAL" },
    overview: null,
  };
}
it("distinguishes loading and unavailable access", async () => {
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading");
  fixture.state = { phase: "forbidden" };
  await act(async () => root.render(<AdminNotifications />));
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "unavailable for your current access",
  );
});
it("requires a selected scope and retries failed reads", async () => {
  ready();
  if (fixture.state.phase === "ready") fixture.state.selectedScope = null;
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Select an Admin scope");
  ready();
  fixture.result = {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Internal", requestId: "test" },
  };
  await act(async () => root.render(<AdminNotifications />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click(),
  );
  expect(fixture.refresh).toHaveBeenCalledOnce();
});
it("uses authorized destinations and scope without read-state actions", async () => {
  ready();
  const scope = { kind: "LOCATION" as const, marketId: "market", locationId: "location" };
  fixture.result = {
    ok: true,
    requestId: "test",
    value: {
      notifications: [
        {
          id: "notice",
          label: "Delivery attempt failed",
          orderId: "order",
          orderNumber: "FM-1",
          occurredAt: "2026-09-13T00:00:00.000Z",
          href: "/admin/delivery?orderId=order",
          scope,
        },
      ],
      generatedAt: "2026-09-13T00:00:00.000Z",
      selectedScope: scope,
      timezone: "Asia/Manila",
      cards: [],
      workloadStages: [],
      exceptions: [],
      recentOperations: [],
      freshness: { sourceWatermark: null, computedAt: "2026-09-13T00:00:00.000Z" },
      deniedSections: [],
    },
  };
  await open();
  expect(document.querySelector('[role="dialog"]')?.classList.contains("fm-admin")).toBe(true);
  expect(document.body.textContent).not.toMatch(/unread|mark.*read/i);
  const link = document.querySelector<HTMLAnchorElement>('a[href="/admin/delivery?orderId=order"]');
  expect(link?.textContent).toContain("Delivery attempt failed");
  await act(async () => link?.click());
  expect(fixture.selectScope).toHaveBeenCalledWith(scope);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
