import { afterEach, describe, expect, it, vi } from "vitest";
import { readBackend } from "./backend";
import { parseEnvironment } from "./environment";

const environment = parseEnvironment({
  variant: "development",
  backendOrigin: "http://localhost:3187",
});
afterEach(() => vi.unstubAllGlobals());
describe("backend connectivity boundary", () => {
  it("works without Node-only AbortSignal static methods", async () => {
    vi.stubGlobal("AbortSignal", {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          service: "core",
          status: "ok",
          environment: "development",
          contractVersion: "test",
          databaseBindingConfigured: true,
        }),
      ),
    );
    expect(await readBackend(environment, new AbortController().signal)).toEqual({
      kind: "available",
    });
  });
  it("reads actual health shape without sending authentication or location identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        service: "core",
        status: "ok",
        environment: "development",
        contractVersion: "test",
        databaseBindingConfigured: true,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await readBackend(environment, new AbortController().signal)).toEqual({
      kind: "available",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3187/api/core-health",
      expect.objectContaining({ credentials: "omit", headers: { Accept: "application/json" } }),
    );
  });
  it.each([
    Response.json({
      service: "core",
      status: "ok",
      environment: "production",
      contractVersion: "test",
      databaseBindingConfigured: true,
    }),
    Response.json({
      service: "core",
      status: "ok",
      environment: "development",
      contractVersion: "test",
      databaseBindingConfigured: false,
    }),
    Response.json({ status: "ok" }),
    new Response("unavailable", { status: 503 }),
    new Response("invalid-json"),
  ])("renders unavailable for rejected or invalid health", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await readBackend(environment, new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });
  it("renders unavailable after a transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
    expect(await readBackend(environment, new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });
});
