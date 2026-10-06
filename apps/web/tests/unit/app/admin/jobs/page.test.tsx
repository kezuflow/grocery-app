// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import AdminJobsPage from "@/app/admin/jobs/page";

afterEach(() => vi.unstubAllGlobals());

it("shows a recorded failed run and its stable error code", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        requestId: "runs",
        value: {
          runs: [
            {
              id: "run-1",
              jobName: "commerce.cycle-cutoff",
              cronExpression: "* * * * *",
              status: "FAILED",
              affectedCount: null,
              errorCode: "SCHEDULED_JOB_ERROR",
              detail: null,
              startedAt: 1_780_000_000_000,
              finishedAt: 1_780_000_000_100,
            },
          ],
        },
      }),
    ),
  );
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(<AdminJobsPage />);
  });
  expect(host.textContent).toContain("commerce.cycle-cutoff");
  expect(host.textContent).toContain("FAILED");
  expect(host.textContent).toContain("SCHEDULED_JOB_ERROR");
  await act(async () => root.unmount());
});
