import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { resolveSecurityHeaderEnvironment, webSecurityHeaders } from "../security/headers";
import { requestHeaders } from "./request";

describe("Core client request boundary", () => {
  it("forwards only approved cookies, request metadata, and browser context", () => {
    const request = new Request("https://freshmarkets.ph/api/admin/context", {
      headers: {
        cookie: "better-auth.session_token=session-value",
        "x-request-id": "request-123",
        "x-correlation-id": "correlation-456",
        origin: "https://freshmarkets.ph",
        referer: "https://freshmarkets.ph/admin",
        "user-agent": "readiness-test",
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer must-not-forward",
        "x-mapbox-access-token": "server-token-must-not-forward",
        "x-mapbox-public-access-token": "public-token-must-not-forward",
        "x-forwarded-for": "192.0.2.1",
        "x-browser-random": "must-not-forward",
      },
    });

    expect(requestHeaders(request)).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      cookie: "better-auth.session_token=session-value",
      origin: "https://freshmarkets.ph",
      referer: "https://freshmarkets.ph/admin",
      "user-agent": "readiness-test",
      "x-request-id": "request-123",
      "x-correlation-id": "correlation-456",
    });
  });

  it("does not create an authorization header or expose request bodies", () => {
    const request = new Request("https://freshmarkets.ph/api/admin/context", {
      headers: { cookie: "session=value", "x-request-id": "request-789" },
    });
    const headers = requestHeaders(request);

    expect(headers.authorization).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-browser-random"]).toBeUndefined();
    expect(headers["x-mapbox-access-token"]).toBeUndefined();
    expect(headers["x-mapbox-public-access-token"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("password");
  });

  it("keeps the Core binding as the only route dependency", async () => {
    const core = { getAdminContext: vi.fn().mockResolvedValue({ ok: false }) };
    expect(core.getAdminContext).toBeDefined();
  });

  it("matches the runbook to the implemented CSP and absent polygon release tooling", async () => {
    const runbookUrl = new URL("../../../../docs/runbooks/MAPS_AND_DISPATCH.md", import.meta.url);
    const runbook = existsSync(runbookUrl) ? readFileSync(runbookUrl, "utf8") : "";
    const configuredHeaders = await nextConfig.headers?.();
    expect(configuredHeaders).toEqual([
      {
        source: "/:path*",
        headers: webSecurityHeaders(resolveSecurityHeaderEnvironment(process.env)),
      },
    ]);

    const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const scriptFiles = [
      ...readdirSync(new URL("../../../../scripts/", import.meta.url)).map(
        (name) => `scripts/${name}`,
      ),
      ...readdirSync(new URL("../../../core/scripts/", import.meta.url)).map(
        (name) => `apps/core/scripts/${name}`,
      ),
    ];
    const polygonReleaseScripts = scriptFiles.filter((relativePath) =>
      readFileSync(`${repositoryRoot}/${relativePath}`, "utf8").match(
        /service_area|delivery_zone|polygon_geojson/i,
      ),
    );
    expect(polygonReleaseScripts).toEqual([]);
    expect(runbook).toContain(
      "Production polygon deployment, activation, validation, and rollback tooling is not implemented.",
    );
    expect(runbook).toContain("worker-src 'self' blob:");
    expect(runbook).toContain("wrangler versions secret put MAPBOX_ACCESS_TOKEN");
  });
});
