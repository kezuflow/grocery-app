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
  return <p>{refresh.activity?.notifications.map((notice) => notice.id).join(",") ?? "empty"}</p>;
}

let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
