// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationQueryProvider, useQueryEpoch } from "./query-provider";
import { queryKeys } from "../lib/query/query-client";

const state = vi.hoisted(() => ({ identity: "first", resetCart: vi.fn(), reload: vi.fn() }));
vi.mock("../lib/query/query-client", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../lib/query/query-client")>()),
  reloadForSessionChange: state.reload,
}));
vi.mock("../lib/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { session: { id: state.identity } }, isPending: false }),
  },
}));
vi.mock("../lib/storefront/cart-client", () => ({ resetCartSession: state.resetCart }));
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("clears private state and gates stale server props until a replacement-session reload", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let oldComplete: (value: string) => void = () => {};
  function PrivateOwner() {
    const epoch = useQueryEpoch();
    const [privateDraft] = useState(state.identity);
    const client = useQueryClient();
    const result = useQuery({
      queryKey: queryKeys.private(epoch, "orders"),
      queryFn: () =>
        state.identity === "first"
          ? new Promise<string>((resolve) => {
              oldComplete = resolve;
            })
          : Promise.resolve("second-order"),
    });
    return (
      <p>
        {privateDraft}:{result.data ?? "loading"}:
        {client.getQueryData(queryKeys.private(0, "orders")) ? "old-data" : "isolated"}
      </p>
    );
  }
  state.identity = "first";
  await act(async () =>
    root.render(
      <ApplicationQueryProvider>
        <PrivateOwner />
      </ApplicationQueryProvider>,
    ),
  );
  state.identity = "second";
  await act(async () =>
    root.render(
      <ApplicationQueryProvider>
        <PrivateOwner />
      </ApplicationQueryProvider>,
    ),
  );
  await act(async () => {
    oldComplete("first-order");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(host.textContent).toBe("Updating session…");
  expect(state.resetCart).toHaveBeenCalledOnce();
  expect(state.reload).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
