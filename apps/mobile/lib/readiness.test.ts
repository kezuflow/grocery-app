import { expect, it, vi } from "vitest";

it("retains the first semantic shell mark across tab mounts", async () => {
  vi.resetModules();
  const readiness = await import("./readiness");
  expect(readiness.shellReadyMilliseconds()).toBeNull();
  const first = readiness.markShellReady(performance.now() + 10);
  expect(first).toBeGreaterThanOrEqual(10);
  expect(readiness.markShellReady(performance.now() + 50)).toBe(first);
});
