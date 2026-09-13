import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-client";
import {
  adminProductDetailResource,
  adminProductListResource,
  adminProductReadIdentity,
  fetchAdminProductDetail,
  invalidateAdminProductQueries,
  isAdminProductWorkspaceVisible,
  isAdminProductRecordCurrent,
  isAdminProductTransientCurrent,
  serializeProductScope,
} from "./admin-products";

describe("admin product query identity", () => {
  it("separates global and exact location scopes", () => {
    expect(serializeProductScope({ kind: "GLOBAL" })).toBe("GLOBAL");
    expect(
      serializeProductScope({ kind: "LOCATION", marketId: "market-a", locationId: "location-b" }),
    ).toBe("LOCATION:market-a:location-b");
  });

  it("keys list filters, cursor, and detail independently", () => {
    expect(adminProductListResource(" apple ", "active", "next")).toBe(
      '["products","list","apple","active","next"]',
    );
    expect(adminProductDetailResource("product-1")).toBe('["products","detail","product-1"]');
  });

  it("invalidates product lists across scopes and only affected detail previews", async () => {
    const client = new QueryClient();
    const globalList = queryKeys.admin(0, "GLOBAL", adminProductListResource("", "all", null));
    const locationList = queryKeys.admin(
      0,
      "LOCATION:market:location",
      adminProductListResource("", "active", null),
    );
    const changedDetail = queryKeys.admin(0, "GLOBAL", adminProductDetailResource("changed"));
    const otherDetail = queryKeys.admin(0, "GLOBAL", adminProductDetailResource("other"));
    for (const key of [globalList, locationList, changedDetail, otherDetail]) {
      client.setQueryData(key, { ok: true });
    }

    await invalidateAdminProductQueries(client, ["changed"]);

    expect(client.getQueryState(globalList)?.isInvalidated).toBe(true);
    expect(client.getQueryState(locationList)?.isInvalidated).toBe(true);
    expect(client.getQueryState(changedDetail)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherDetail)?.isInvalidated).toBe(false);
  });

  it("hides transient product workspaces synchronously when scope changes", () => {
    expect(isAdminProductWorkspaceVisible(true, "GLOBAL", "GLOBAL")).toBe(true);
    expect(isAdminProductWorkspaceVisible(true, "GLOBAL", "LOCATION:market:location")).toBe(false);
    expect(isAdminProductWorkspaceVisible(false, "GLOBAL", "GLOBAL")).toBe(false);
  });

  it("exposes a loaded product only for its exact current product and scope", () => {
    const global = { kind: "GLOBAL" } as const;
    const location = { kind: "LOCATION", marketId: "market", locationId: "location" } as const;
    const identity = adminProductReadIdentity("product-1", global);
    expect(isAdminProductRecordCurrent(identity, "product-1", global)).toBe(true);
    expect(isAdminProductRecordCurrent(identity, "product-2", global)).toBe(false);
    expect(isAdminProductRecordCurrent(identity, "product-1", location)).toBe(false);
    expect(isAdminProductRecordCurrent(identity, "product-1", null)).toBe(false);
  });

  it("closes portal-backed transients when their captured read identity is stale", () => {
    expect(isAdminProductTransientCurrent(true, "read-a", "read-a")).toBe(true);
    expect(isAdminProductTransientCurrent(false, "read-a", "read-a")).toBe(false);
    expect(isAdminProductTransientCurrent(true, "read-a", "read-b")).toBe(false);
    expect(isAdminProductTransientCurrent(true, null, "read-a")).toBe(false);
  });

  it("rejects malformed product detail payloads at the shared fetch boundary", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          value: { productId: "product-1", name: "Incomplete product" },
          requestId: "request-1",
        }),
        { headers: { "content-type": "application/json" } },
      );
    try {
      await expect(
        fetchAdminProductDetail({ scope: { kind: "GLOBAL" }, productId: "product-1" }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
