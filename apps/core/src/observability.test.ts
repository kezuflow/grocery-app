import { afterEach, describe, expect, it, vi } from "vitest";
import { log, observeCoreRpc, requestId } from "./observability";

afterEach(() => vi.restoreAllMocks());

describe("Core observability boundary", () => {
  it("redacts secret-bearing fields while preserving the safe diagnostic vocabulary", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);

    log("info", "security.test", {
      requestId: "request-safe",
      authorization: "Bearer live-secret",
      cookie: "session=live-cookie",
      actionUrl: "https://provider.invalid/continue?token=secret",
    });

    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"requestId":"request-safe"');
    expect(output.match(/\[REDACTED\]/gu)).toHaveLength(3);
    expect(output).not.toContain("live-secret");
    expect(output).not.toContain("live-cookie");
    expect(output).not.toContain("provider.invalid");
  });

  it("rejects oversized or unsafe inbound request IDs", () => {
    const generated = "83bdd119-b656-4ba9-bfe3-b8e274056572";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generated);

    expect(
      requestId(
        new Request("https://core.invalid", { headers: { "x-request-id": "a".repeat(129) } }),
      ),
    ).toBe(generated);
    expect(
      requestId(
        new Request("https://core.invalid", { headers: { "x-request-id": "unsafe request" } }),
      ),
    ).toBe(generated);
    expect(
      requestId(
        new Request("https://core.invalid", { headers: { "x-request-id": "safe-id:123" } }),
      ),
    ).toBe(generated);
    const valid = "ddeb27fb-d9a0-4b8d-8c15-0f765799db42";
    expect(
      requestId(new Request("https://core.invalid", { headers: { "x-request-id": valid } })),
    ).toBe(valid);
  });

  it("records a safe RPC completion without serializing response data", async () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requestId = "ddeb27fb-d9a0-4b8d-8c15-0f765799db42";

    const result = await observeCoreRpc("admin.test", requestId, async () => ({
      ok: true as const,
      value: { secretCustomerValue: "must-not-be-logged" },
      requestId,
    }));

    expect(result.ok).toBe(true);
    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"operation":"admin.test"');
    expect(output).toContain(`"requestId":"${requestId}"`);
    expect(output).not.toContain("must-not-be-logged");
  });
});
