import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createCatalogRpc } from "./catalog-rpc";
import { issueBrowsingContext } from "../geography/application/browsing-context";

const contextSecret = "test-only-catalog-context-secret-at-least-32-characters";
const rpc = () =>
  createCatalogRpc(
    createCoreRpcContext({
      ...env,
      BETTER_AUTH_SECRET: contextSecret,
      ENVIRONMENT: "test",
    } as never),
  );

describe("Catalog RPC adapter", () => {
  it("rejects invalid input with the stable request reference", async () => {
    const result = await rpc().searchCatalog({ requestId: "catalog-adapter", limit: 0 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", requestId: "catalog-adapter" },
    });
  });

  it("delegates valid category reads without exposing rows", async () => {
    const result = await rpc().listCategories({ requestId: "catalog-categories" });
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("catalog-categories");
  });

  it("accepts only a Core-signed location context for location-aware catalog reads", async () => {
    const token = await issueBrowsingContext(contextSecret, {
      locationId: "location-cebu-central",
      serviceAreaCode: "CEBU",
      serviceAreaVersion: 1,
    });
    const accepted = await rpc().getCatalogProduct({
      requestId: "catalog-context",
      slug: "red-onion",
      browsingContextToken: token,
    });
    expect(accepted).toMatchObject({
      ok: true,
      value: { deliveryContext: { locationAware: true } },
    });
    const rejected = await rpc().getCatalogProduct({
      requestId: "catalog-context-tampered",
      slug: "red-onion",
      browsingContextToken: `${token}x`,
    });
    expect(rejected).toMatchObject({
      ok: true,
      value: { deliveryContext: { locationAware: false } },
    });
  });
});
