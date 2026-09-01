import { afterEach, describe, expect, it, vi } from "vitest";
import { adminJson, observeAdminRoute } from "./admin-route-observability";

afterEach(() => vi.restoreAllMocks());

describe("Admin Web route observability", () => {
  it("uses one validated request ID for the adapter, Core-bound request, and response", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requestId = "ddeb27fb-d9a0-4b8d-8c15-0f765799db42";
    const handler = observeAdminRoute("admin.test.get", (request) =>
      adminJson({ requestId: request.headers.get("x-request-id") }),
    );

    const response = await handler(
      new Request("https://web.invalid/api/admin/test", {
        headers: { "x-request-id": requestId },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toEqual({ requestId });
    expect(response.headers.get("server-timing")).toContain("serialize;dur=");
    expect(response.headers.get("server-timing")).toContain("web;dur=");
  });

  it("replaces an unsafe inbound identifier with a bounded UUID", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const generated = "83bdd119-b656-4ba9-bfe3-b8e274056572";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(generated);
    const handler = observeAdminRoute("admin.test.get", (request) =>
      adminJson({ requestId: request.headers.get("x-request-id") }),
    );

    const response = await handler(
      new Request("https://web.invalid/api/admin/test", {
        headers: { "x-request-id": "unsafe identifier" },
      }),
    );

    expect(response.headers.get("x-request-id")).toBe(generated);
    expect(await response.json()).toEqual({ requestId: generated });
  });

  it("does not replace an adapter exception or log its message", async () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("sensitive failure detail");
    const handler = observeAdminRoute("admin.test.get", () => {
      throw failure;
    });

    await expect(handler(new Request("https://web.invalid/api/admin/test"))).rejects.toBe(failure);
    expect(String(write.mock.calls[0]?.[0])).not.toContain("sensitive failure detail");
  });
});
