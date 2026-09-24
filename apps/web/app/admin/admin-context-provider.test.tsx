// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  AdminContextProvider,
  useAdminContext,
  useAdminScopeGuard,
} from "./admin-context-provider";
import {
  hasAdminScopeCommandLock,
  setAdminScopeCommandLock,
} from "@/components/admin/admin-scope-command-lock";
import { useAdminCommand } from "@/components/admin/use-admin-command";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const location = { kind: "LOCATION" as const, marketId: "market", locationId: "central" };
const bootstrap = {
  ok: true,
  requestId: "test",
  value: {
    context: {
      staffId: "staff",
      displayName: "Staff",
      email: "staff@example.com",
      capabilities: [],
      scopes: [{ kind: "global" }],
      navigation: [],
      environment: "test",
    },
    scopes: [
      { kind: "location", marketId: "market", locationId: "central", locationName: "Central Cebu" },
    ],
    selection: { selectedScope: { kind: "GLOBAL" } },
    overview: null,
  },
};

function Probe({
  dirty = false,
  locked = false,
  onDiscard,
}: {
  dirty?: boolean;
  locked?: boolean;
  onDiscard?: () => void;
}) {
  const { state, selectScope } = useAdminContext();
  useAdminScopeGuard(dirty, locked, onDiscard);
  return (
    <div>
      <p>{state.phase === "ready" ? state.selectedScope?.kind : state.phase}</p>
      <button type="button" onClick={() => selectScope(location)}>
        Select Central Cebu
      </button>
    </div>
  );
}

function CommandProbe() {
  const command = useAdminCommand();
  return (
    <>
      <Probe />
      <button type="button" onClick={() => void command.run("save", "/api/test", {})}>
        Save
      </button>
      <button type="button" onClick={() => void command.retry()}>
        Retry
      </button>
    </>
  );
}

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin?status=COMMITTED&cursor=old&cursorHistory=");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => bootstrap })),
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.mocked(toast.error).mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderProbe(props: { dirty?: boolean; locked?: boolean; onDiscard?: () => void }) {
  await act(async () =>
    root.render(
      <AdminContextProvider>
        <Probe {...props} />
      </AdminContextProvider>,
    ),
  );
  expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
}

async function selectLocation() {
  await act(async () => host.querySelector("button")?.click());
}

it("asks before discarding a dirty scope and honors cancellation", async () => {
  const onDiscard = vi.fn();
  await renderProbe({ dirty: true, onDiscard });
  await selectLocation();
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
  expect(onDiscard).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("LOCATION");
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(window.location.search).toBe("?status=COMMITTED");
});

it("blocks scope changes while a form or command is pending", async () => {
  await renderProbe({ locked: true });
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
  expect(toast.error).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      <AdminContextProvider>
        <Probe />
      </AdminContextProvider>,
    ),
  );
  const command = {};
  setAdminScopeCommandLock(command, true);
  try {
    await selectLocation();
    expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
  } finally {
    setAdminScopeCommandLock(command, false);
  }
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("LOCATION");
});

it("keeps a generic admin command bound to its scope through unknown recovery", async () => {
  await act(async () =>
    root.render(
      <AdminContextProvider>
        <CommandProbe />
      </AdminContextProvider>,
    ),
  );
  let rejectRequest: (reason: Error) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    ),
  );
  await act(async () => host.querySelectorAll("button")[1]?.click());
  expect(hasAdminScopeCommandLock()).toBe(true);
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
  await act(async () => rejectRequest(new Error("Network lost")));
  expect(hasAdminScopeCommandLock()).toBe(true);
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("GLOBAL");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ ok: true, value: {} }) })),
  );
  await act(async () => host.querySelectorAll("button")[2]?.click());
  expect(hasAdminScopeCommandLock()).toBe(false);
  await selectLocation();
  expect(host.querySelector("p")?.textContent).toBe("LOCATION");
});
