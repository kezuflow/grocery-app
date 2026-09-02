import type { AdminProductPage, RpcResult } from "@freshmarkets/contracts";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { cache } from "react";
import { parseAdminProductScopeTargetCookie } from "@/lib/admin/product-scope-target";
import type { AdminProductScopeTarget } from "@/lib/admin/product-scope-target";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { ProductsPageClient } from "./products-page-client";

type ProductSearchParams = {
  query?: string;
  status?: string;
};

function invalidProductStatus(requestId: string): RpcResult<AdminProductPage> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: "status must be active or inactive",
      requestId,
    },
  };
}

function plainResult<T>(result: RpcResult<T>): RpcResult<T> {
  return JSON.parse(JSON.stringify(result)) as RpcResult<T>;
}

const loadInitialProductPage = cache(
  async (
    query: string,
    status: string,
  ): Promise<{
    payload: RpcResult<AdminProductPage> | null;
    scopeTarget: AdminProductScopeTarget | null;
  }> => {
    const incomingHeaders = await headers();
    const scopeTarget = parseAdminProductScopeTargetCookie(incomingHeaders.get("cookie"));
    const requestId = crypto.randomUUID();
    if (status !== "all" && status !== "active" && status !== "inactive") {
      return { payload: invalidProductStatus(requestId), scopeTarget };
    }
    if (!scopeTarget) return { payload: null, scopeTarget: null };
    const result = await coreClient(env.CORE).listAdminProducts({
      requestId,
      headers: {
        ...coreRequestHeaders(new Headers(incomingHeaders)),
        "x-request-id": requestId,
      },
      ...(scopeTarget.kind === "LOCATION"
        ? {
            scopeKind: "LOCATION" as const,
            marketId: scopeTarget.marketId,
            locationId: scopeTarget.locationId,
          }
        : { scopeKind: "GLOBAL" as const }),
      query: query || undefined,
      status: status === "all" ? undefined : status,
      limit: 50,
    });
    return { payload: plainResult(result), scopeTarget };
  },
);

/** Server-first Product list when the browser has supplied a Core-validated pricing hint. */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<ProductSearchParams>;
}) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const status = params.status ?? "all";
  const { payload: initialPayload, scopeTarget } = await loadInitialProductPage(query, status);

  return (
    <ProductsPageClient
      key={`${scopeTarget?.kind ?? "pending"}:${scopeTarget?.kind === "LOCATION" ? scopeTarget.locationId : "global"}:${query}:${status}`}
      initialPayload={initialPayload}
      initialScopeTarget={scopeTarget}
      initialQuery={query}
      initialStatus={status}
    />
  );
}
