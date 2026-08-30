import { describe, expect, it, vi } from "vitest";
import { jsonWithRequestId, webRequestContext } from "./request-context";

describe("Web request correlation", () => {
  it("preserves one valid inbound UUID in Core headers and responses", async () => {
    const requestId = "8df68f7f-e2b8-4f54-b77a-b1a6e4271290";
    const context = webRequestContext(
      new Request("https://freshmarkets.test", {
        headers: { cookie: "session=a", "x-request-id": requestId },
      }),
    );
    expect(context).toEqual({
      requestId,
      coreHeaders: { cookie: "session=a", "x-request-id": requestId },
    });
    const response = jsonWithRequestId({ ok: true, requestId }, requestId, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toEqual({ ok: true, requestId });
  });

  it.each(["", "not-a-uuid", "a".repeat(200)])("replaces invalid inbound IDs", (inbound) => {
    const generated = "7f154717-4898-4d58-8899-351208e634f8";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generated);
    const context = webRequestContext(
      new Request("https://freshmarkets.test", { headers: { "x-request-id": inbound } }),
    );
    expect(context.requestId).toBe(generated);
    expect(context.coreHeaders["x-request-id"]).toBe(generated);
    vi.restoreAllMocks();
  });
});
