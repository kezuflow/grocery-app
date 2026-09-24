// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  AdminOperationalRefreshProvider,
  useAdminOperationalRefresh,
} from "./admin-operational-refresh-provider";

const fixture = vi.hoisted(() => ({
  state: {
    phase: "ready",
    selectedScope: { kind: "LOCATION", marketId: "market", locationId: "location" },
  },
}));
vi.mock("./admin-context-provider", () => ({ useAdminContext: () => fixture }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

const result = (ids: string[]) => ({
  ok: true as const,
  requestId: "activity",
  value: {
    notifications: ids.map((id) => ({
      id,
      label: "New paid order",
      orderId: id,
      orderNumber: id.toUpperCase(),
      occurredAt: "2026-09-22T01:00:00.000Z",
      href: `/admin/fulfillment?orderId=${id}`,
      scope: null,
    })),
    latest: ids[0] ? { id: ids[0], occurredAt: "2026-09-22T01:00:00.000Z" } : null,
  },
});

function Probe() {
  const refresh = useAdminOperationalRefresh();
  return (
    <p data-stale={refresh.stale}>
      {refresh.activity?.notifications.map((notice) => notice.id).join(",") ?? "empty"}
    </p>
  );
}

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.state.selectedScope.locationId = "location";
  sessionStorage.clear();
  vi.mocked(toast.info).mockReset();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("preserves activity during refresh and announces each new paid order once per session", async () => {
  const replies = [
    result(["order:first"]),
    result(["order:first"]),
    result(["order:second", "order:first"]),
    result(["order:second", "order:first"]),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => replies.shift()! })),
  );
  await act(async () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    ),
  );
  expect(document.body.textContent).toContain("order:first");
  expect(toast.info).not.toHaveBeenCalled();

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.body.textContent).toContain("order:first");
  expect(toast.info).not.toHaveBeenCalled();

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.body.textContent).toContain("order:second,order:first");
  expect(toast.info).toHaveBeenCalledOnce();

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(toast.info).toHaveBeenCalledOnce();
});

it("publishes valid activity and deduplicates notices when session storage throws", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  const replies = [result(["order:first"]), result(["order:second", "order:first"])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => replies.shift()! })),
  );

  await act(async () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    ),
  );
  expect(document.querySelector("p")?.dataset.stale).toBe("false");
  expect(document.body.textContent).toContain("order:first");

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.querySelector("p")?.dataset.stale).toBe("false");
  expect(document.body.textContent).toContain("order:second,order:first");
  expect(toast.info).toHaveBeenCalledOnce();
});

it("hides prior-location activity immediately while the next location loads", async () => {
  let finishSecond: ((value: ReturnType<typeof result>) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ json: async () => result(["order:first"]) })
      .mockResolvedValueOnce({
        json: () =>
          new Promise<ReturnType<typeof result>>((resolve) => {
            finishSecond = resolve;
          }),
      }),
  );
  const render = () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    );
  await act(async () => render());
  expect(document.body.textContent).toContain("order:first");
  fixture.state.selectedScope.locationId = "other";
  await act(async () => render());
  expect(document.body.textContent).toContain("empty");
  expect(document.body.textContent).not.toContain("order:first");
  await act(async () => finishSecond?.(result(["order:other"])));
  expect(document.body.textContent).toContain("order:other");
});
