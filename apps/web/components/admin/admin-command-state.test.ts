import { describe, expect, it, vi } from "vitest";
import type { RpcResult } from "@freshmarkets/contracts";
import { createAdminCommandIntent } from "./admin-command-state";

function keys() {
  let value = 0;
  return () => `key-${++value}`;
}

describe("Admin command intent", () => {
  it("coalesces double submission and rotates after a definitive response", async () => {
    let resolve!: (result: RpcResult<string>) => void;
    const run = vi.fn(() => new Promise<RpcResult<string>>((done) => (resolve = done)));
    const intent = createAdminCommandIntent(undefined, keys());
    const first = intent.submit(run);
    const second = intent.submit(run);
    expect(run).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("key-1");
    expect(intent.pending).toBe(true);
    resolve({ ok: true, value: "done", requestId: "request-1" });
    await expect(first).resolves.toMatchObject({ ok: true, value: "done" });
    await expect(second).resolves.toMatchObject({ ok: true, value: "done" });
    expect(intent.pending).toBe(false);
    expect(intent.idempotencyKey).toBe("key-2");
  });

  it("retains its key after an ambiguous transport failure", async () => {
    const intent = createAdminCommandIntent(undefined, keys());
    await expect(
      intent.submit(async () => Promise.reject(new Error("connection lost"))),
    ).rejects.toThrow("connection lost");
    expect(intent.idempotencyKey).toBe("key-1");
    await intent.submit(async (key) => ({ ok: true, value: key, requestId: "request-2" }));
    expect(intent.idempotencyKey).toBe("key-2");
  });

  it("rotates after a definitive typed rejection", async () => {
    const intent = createAdminCommandIntent(undefined, keys());
    await intent.submit(async () => ({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "invalid", requestId: "request-3" },
    }));
    expect(intent.idempotencyKey).toBe("key-2");
  });
});
