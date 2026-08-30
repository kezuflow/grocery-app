import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createMembershipRpc } from "./membership-rpc";

describe("Membership RPC adapter", () => {
  it("preserves unauthenticated resolution and request ID", async () => {
    const rpc = createMembershipRpc(createCoreRpcContext(env));
    const result = await rpc.getSubscriptionEligibility({
      requestId: "membership-adapter",
      headers: {},
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED", requestId: "membership-adapter" },
    });
  });
});
