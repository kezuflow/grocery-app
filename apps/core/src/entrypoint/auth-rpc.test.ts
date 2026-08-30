import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createAuthRpc } from "./auth-rpc";

describe("Auth RPC adapter", () => {
  it("delegates unauthenticated application context through the canonical authority", async () => {
    const rpc = createAuthRpc(createCoreRpcContext(env));
    const result = await rpc.getApplicationContext({ requestId: "auth-adapter", headers: {} });
    expect(result).toMatchObject({
      ok: true,
      value: { authenticated: false },
      requestId: "auth-adapter",
    });
  });
});
