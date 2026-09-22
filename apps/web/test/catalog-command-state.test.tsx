// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "@freshmarkets/validation";
import { useCatalogCommand } from "../components/admin/catalog-command-state";

const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../components/admin/admin-feedback", () => ({
  notifyCommandSuccess: feedback.success,
}));

function Consumer() {
  const command = useCatalogCommand(z.object({ id: z.string() }));
  return (
    <div>
      <button
        data-action="submit"
        onClick={() =>
          void command
            .submit("/api/admin/catalog/example", { value: 1 }, "POST", {
              title: "Catalog saved",
            })
            .catch(() => undefined)
        }
      >
        Submit
      </button>
      <button data-action="retry" onClick={() => void command.retry()}>
        Retry
      </button>
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "catalog-key" });
  fetchMock.mockReset();
  feedback.success.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Consumer />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function click(action: "submit" | "retry") {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
  });
}

it("retains success feedback and the idempotency key until retry is confirmed", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable")).mockResolvedValueOnce({
    json: async () => ({ ok: true, value: { id: "saved" }, requestId: "request" }),
  });

  await click("submit");
  expect(feedback.success).not.toHaveBeenCalled();

  await click("retry");
  expect(feedback.success).toHaveBeenCalledExactlyOnceWith(
    "Catalog saved",
    undefined,
    "catalog-command:catalog-key",
  );
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    headers: expect.objectContaining({ "idempotency-key": "catalog-key" }),
  });
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    headers: expect.objectContaining({ "idempotency-key": "catalog-key" }),
  });
});
