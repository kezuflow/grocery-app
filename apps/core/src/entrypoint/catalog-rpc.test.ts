import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCoreRpcContext } from "./context";
import { createCatalogRpc } from "./catalog-rpc";

describe("Catalog RPC adapter", () => {
  it("rejects invalid input with the stable request reference", async () => {
    const rpc = createCatalogRpc(createCoreRpcContext(env));
    const result = await rpc.searchCatalog({ requestId: "catalog-adapter", limit: 0 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED", requestId: "catalog-adapter" },
    });
  });

  it("delegates valid category reads without exposing rows", async () => {
    const rpc = createCatalogRpc(createCoreRpcContext(env));
    const result = await rpc.listCategories({ requestId: "catalog-categories" });
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("catalog-categories");
  });
});
