// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminContextState } from "../app/admin/admin-context-provider";
import type { AdminOverviewView, AdminSelectedScope } from "@freshmarkets/contracts";
import { AdminOverviewProvider, useAdminOverview } from "../app/admin/admin-overview-provider";

const fixture = vi.hoisted(() => ({ state: { phase: "loading" } as AdminContextState }));
vi.mock("../app/admin/admin-context-provider", () => ({ useAdminContext: () => fixture }));
const globalScope = { kind: "GLOBAL" } as const;
function overview(scope: AdminSelectedScope): AdminOverviewView {
  return {
    selectedScope: scope,
    timezone: "UTC",
    notifications: [],
    generatedAt: "2026-09-13T00:00:00.000Z",
    cards: [],
    workloadStages: [],
    exceptions: [],
    recentOperations: [],
    freshness: { computedAt: "2026-09-13T00:00:00.000Z", sourceWatermark: null },
    deniedSections: [],
  };
}
function Consumer() {
  const { result, refresh } = useAdminOverview();
  return (
    <div>
      <span>{!result ? "loading" : result.ok ? result.value.selectedScope.kind : "error"}</span>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fixture.state = {
    phase: "ready",
    context: {
      staffId: "staff",
      displayName: "Staff",
      email: "staff@example.com",
      capabilities: [],
      scopes: [],
      navigation: [],
      environment: "test",
    },
    scopes: [],
    selectedScope: globalScope,
    overview: overview(globalScope),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <AdminOverviewProvider>
        <Consumer />
        <Consumer />
      </AdminOverviewProvider>,
    ),
  );
}
it("shares the bootstrap and one refresh across both consumers", async () => {
  await render();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.textContent).toBe("GLOBALRefreshGLOBALRefresh");
  fetchMock.mockResolvedValue({
    json: async () => ({ ok: true, value: overview(globalScope), requestId: "test" }),
  });
  await act(async () => host.querySelector("button")?.click());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(host.textContent).toBe("GLOBALRefreshGLOBALRefresh");
});
it("hides stale scope data and discards late responses", async () => {
  await render();
  let finish: ((value: unknown) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const location: AdminSelectedScope = {
    kind: "LOCATION",
    marketId: "market",
    locationId: "location",
  };
  if (fixture.state.phase !== "ready") throw new Error("Missing fixture");
  fixture.state = { ...fixture.state, selectedScope: location, overview: null };
  await render();
  expect(host.textContent).toBe("loadingRefreshloadingRefresh");
  fixture.state = { ...fixture.state, selectedScope: globalScope, overview: overview(globalScope) };
  await render();
  await act(async () =>
    finish?.({ json: async () => ({ ok: true, value: overview(location), requestId: "late" }) }),
  );
  expect(host.textContent).toBe("GLOBALRefreshGLOBALRefresh");
});

it("does not reuse a previous staff member's loaded overview", async () => {
  await render();
  fetchMock.mockResolvedValueOnce({
    json: async () => ({ ok: true, value: overview(globalScope), requestId: "first-staff" }),
  });
  await act(async () => host.querySelector("button")?.click());
  expect(host.textContent).toBe("GLOBALRefreshGLOBALRefresh");
  if (fixture.state.phase !== "ready") throw new Error("Missing fixture");
  fixture.state = {
    ...fixture.state,
    context: { ...fixture.state.context, staffId: "another-staff" },
    overview: null,
  };
  fetchMock.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  expect(host.textContent).toBe("loadingRefreshloadingRefresh");
});
