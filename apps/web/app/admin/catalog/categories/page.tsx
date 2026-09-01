import type { AdminCategoryPage, RpcResult } from "@freshmarkets/contracts";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { cache } from "react";
import { coreClient } from "@/lib/core-client/core";
import { coreRequestHeaders } from "@/lib/core-client/request";
import { CategoriesPageClient } from "./categories-page-client";

type CategorySearchParams = {
  query?: string;
  status?: string;
};

function invalidCategoryStatus(requestId: string): RpcResult<AdminCategoryPage> {
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

const loadInitialCategoryPage = cache(
  async (query: string, status: string): Promise<RpcResult<AdminCategoryPage>> => {
    const requestId = crypto.randomUUID();
    if (status !== "all" && status !== "active" && status !== "inactive") {
      return invalidCategoryStatus(requestId);
    }
    const incomingHeaders = await headers();
    const result = await coreClient(env.CORE).listAdminCategories({
      requestId,
      headers: {
        ...coreRequestHeaders(new Headers(incomingHeaders)),
        "x-request-id": requestId,
      },
      query: query || undefined,
      status: status === "all" ? undefined : status,
      limit: 50,
    });
    return plainResult(result);
  },
);

/** Server-first list read; subsequent cursor pages remain interactive in the client boundary. */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<CategorySearchParams>;
}) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const status = params.status ?? "all";
  const initialPayload = await loadInitialCategoryPage(query, status);

  return (
    <CategoriesPageClient
      key={`${query}:${status}`}
      initialPayload={initialPayload}
      initialQuery={query}
      initialStatus={status}
    />
  );
}
