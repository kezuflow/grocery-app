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
    const attributes: Array<[string, string | number | boolean]> = [];

    const result = await observeCoreRpc("admin.test", requestId, async (span) => {
      vi.spyOn(span, "setAttribute").mockImplementation((key, value) => {
        attributes.push([key, value]);
        return span;
      });
      return {
        ok: true as const,
        value: { secretCustomerValue: "must-not-be-logged" },
        requestId,
      };
    });

    expect(result.ok).toBe(true);
    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"operation":"admin.test"');
    expect(output).toContain(`"requestId":"${requestId}"`);
    expect(output).toContain('"transportOutcome":"completed"');
    expect(output).toContain('"businessOutcome":"accepted"');
    expect(attributes).toContainEqual(["rpc.business_outcome", "accepted"]);
    expect(output).not.toContain("must-not-be-logged");
    expect(JSON.stringify(attributes)).not.toContain("must-not-be-logged");
  });

  it("marks a typed rejection in its RPC span and structured log without leaking error details", async () => {
    const write = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const attributes: Array<[string, string | number | boolean]> = [];

    const result = await observeCoreRpc("admin.test", "request-safe", async (span) => {
      vi.spyOn(span, "setAttribute").mockImplementation((key, value) => {
        attributes.push([key, value]);
        return span;
      });
      return {
        ok: false as const,
        error: {
          code: "FORBIDDEN",
          message: "Customer secret must not appear",
          details: { token: "sensitive-token" },
        },
      };
    });

    expect(result.ok).toBe(false);
    expect(attributes).toContainEqual(["rpc.business_outcome", "rejected"]);
    expect(attributes).toContainEqual(["rpc.error_code", "FORBIDDEN"]);
    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"transportOutcome":"completed"');
    expect(output).toContain('"businessOutcome":"rejected"');
    expect(output).toContain('"errorCode":"FORBIDDEN"');
    expect(output).not.toContain("Customer secret");
    expect(output).not.toContain("sensitive-token");
    expect(JSON.stringify(attributes)).not.toContain("Customer secret");
    expect(JSON.stringify(attributes)).not.toContain("sensitive-token");
  });

  it("does not record an unrecognized rejection code or confuse an exception with a rejection", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const attributes: Array<[string, string | number | boolean]> = [];

    await observeCoreRpc("admin.test", "request-safe", async (span) => {
      vi.spyOn(span, "setAttribute").mockImplementation((key, value) => {
        attributes.push([key, value]);
        return span;
      });
      return { ok: false, error: { code: "customer-secret", message: "not for telemetry" } };
    });
    expect(attributes).toContainEqual(["rpc.business_outcome", "rejected"]);
    expect(attributes.some(([key]) => key === "rpc.error_code")).toBe(false);
    expect(String(warning.mock.calls[0]?.[0])).not.toContain("customer-secret");

    const exceptionAttributes: Array<[string, string | number | boolean]> = [];
    await expect(
      observeCoreRpc("admin.test", "request-safe", async (span) => {
        vi.spyOn(span, "setAttribute").mockImplementation((key, value) => {
          exceptionAttributes.push([key, value]);
          return span;
        });
        throw new Error("private provider payload");
      }),
    ).rejects.toThrow("private provider payload");
    expect(exceptionAttributes).toContainEqual(["result", "exception"]);
    expect(exceptionAttributes.some(([key]) => key === "rpc.business_outcome")).toBe(false);
    expect(JSON.stringify(exceptionAttributes)).not.toContain("private provider payload");
    const output = String(failure.mock.calls[0]?.[0]);
    expect(output).toContain('"transportOutcome":"exception"');
    expect(output).toContain('"businessOutcome":"not_returned"');
    expect(output).not.toContain("private provider payload");
  });
});
