import type { AdminProductPage, RpcResult } from "@freshmarkets/contracts";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { cache } from "react";
import { parseAdminProductPricingTargetCookie } from "@/lib/admin/product-pricing-target";
import type { AdminProductPricingTarget } from "@/lib/admin/product-pricing-target";
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
    pricingTarget: AdminProductPricingTarget | null;
  }> => {
    const incomingHeaders = await headers();
    const pricingTarget = parseAdminProductPricingTargetCookie(incomingHeaders.get("cookie"));
    const requestId = crypto.randomUUID();
    if (status !== "all" && status !== "active" && status !== "inactive") {
      return { payload: invalidProductStatus(requestId), pricingTarget };
    }
    if (!pricingTarget) return { payload: null, pricingTarget: null };
    const result = await coreClient(env.CORE).listAdminProducts({
      requestId,
      headers: {
        ...coreRequestHeaders(new Headers(incomingHeaders)),
        "x-request-id": requestId,
      },
      marketId: pricingTarget.marketId,
      locationId: pricingTarget.locationId,
      query: query || undefined,
      status: status === "all" ? undefined : status,
      limit: 50,
    });
    return { payload: plainResult(result), pricingTarget };
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
  const { payload: initialPayload, pricingTarget } = await loadInitialProductPage(query, status);

  return (
    <ProductsPageClient
      key={`${pricingTarget?.marketId ?? "pending"}:${pricingTarget?.locationId ?? "market"}:${query}:${status}`}
      initialPayload={initialPayload}
      initialPricingTarget={pricingTarget}
      initialQuery={query}
      initialStatus={status}
    />
  );
}
