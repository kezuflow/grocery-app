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
    context: { capabilities: ["fulfillment.read"] },
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
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  emit(revision: number) {
    this.onmessage?.({ data: JSON.stringify({ revision }) });
  }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.state.selectedScope.locationId = "location";
  fixture.state.context.capabilities = ["fulfillment.read"];
  sessionStorage.clear();
  vi.mocked(toast.info).mockReset();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  expect(document.querySelector("p")?.dataset.stale).toBe("true");
  expect(document.body.textContent).toContain("order:first");

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.querySelector("p")?.dataset.stale).toBe("true");
  expect(document.body.textContent).toContain("order:second,order:first");
  expect(toast.info).toHaveBeenCalledOnce();
});

it("refreshes for newer location revisions without treating progress as a new paid order", async () => {
  const replies = [
    result(["order:first"]),
    result(["order:first"]),
    result(["order:first"]),
    result(["order:second", "order:first"]),
  ];
  const fetcher = vi.fn(async () => ({ json: async () => replies.shift()! }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    ),
  );
  const socket = FakeWebSocket.instances[0]!;
  await act(async () => socket.onopen?.());
  await act(async () => socket.emit(1));
  expect(toast.info).not.toHaveBeenCalled();
  await act(async () => socket.emit(1));
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => socket.emit(2));
  expect(toast.info).toHaveBeenCalledOnce();
});

it("retries a failed activity read while the stream remains open", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ json: async () => result(["order:first"]) })
    .mockRejectedValueOnce(new Error("temporary read failure"))
    .mockResolvedValue({ json: async () => result(["order:first"]) });
  vi.stubGlobal("fetch", fetcher);
  await act(async () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    ),
  );
  await act(async () => FakeWebSocket.instances[0]?.onopen?.());
  expect(document.querySelector("p")?.dataset.stale).toBe("true");
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(document.body.textContent).toContain("order:first");
  expect(document.querySelector("p")?.dataset.stale).toBe("false");
});

it("does not open the operational stream for staff without a relevant read capability", async () => {
  fixture.state.context.capabilities = [];
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await act(async () =>
    root.render(
      <AdminOperationalRefreshProvider>
        <Probe />
      </AdminOperationalRefreshProvider>,
    ),
  );
  expect(FakeWebSocket.instances).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
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
