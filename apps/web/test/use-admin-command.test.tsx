// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAdminCommand } from "../components/admin/use-admin-command";

const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../components/admin/admin-feedback", () => ({
  notifyCommandSuccess: feedback.success,
}));

function Consumer() {
  const command = useAdminCommand();
  return (
    <div>
      <button
        data-action="run"
        onClick={() =>
          void command.run("save", "/api/admin/example", { value: 1 }, "POST", {
            title: "Example saved",
          })
        }
      >
        Run
      </button>
      <button data-action="retry" onClick={() => void command.retry()}>
        Retry
      </button>
      <span>{command.notice}</span>
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "operation-key" });
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

async function click(action: "run" | "retry") {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
  });
}

it("toasts once after Core confirms the command", async () => {
  fetchMock.mockResolvedValueOnce({
    json: async () => ({ ok: true, value: {} }),
  });

  await click("run");

  expect(feedback.success).toHaveBeenCalledOnce();
  expect(feedback.success).toHaveBeenCalledWith(
    "Example saved",
    undefined,
    "admin-command:operation-key",
  );
});

it("does not toast a typed command failure", async () => {
  fetchMock.mockResolvedValueOnce({
    json: async () => ({ ok: false, error: { message: "Rejected" } }),
  });

  await click("run");

  expect(feedback.success).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Rejected");
});

it("retains feedback through an uncertain retry and only toasts confirmed success", async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError("Network unavailable"))
    .mockResolvedValueOnce({ json: async () => ({ ok: true, value: {} }) });

  await click("run");
  expect(feedback.success).not.toHaveBeenCalled();
  expect(host.textContent).toContain("could not be confirmed");

  await click("retry");
  expect(feedback.success).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    headers: expect.objectContaining({ "idempotency-key": "operation-key" }),
  });
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    headers: expect.objectContaining({ "idempotency-key": "operation-key" }),
  });
});
