import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { readBrowsingLocation } from "@/lib/storefront/read-browsing-location";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 24;

function positiveIntParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Catalog search proxy forwarding query, category, cursor, and location
 * filters to Core. Core owns cursor validation; its failure envelope is
 * forwarded verbatim without exposing internals.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { requestId } = webRequestContext(request);
  const catalogLocation = await readBrowsingLocation(request.headers.get("cookie") ?? "");
  if (url.searchParams.get("home") === "1") {
    const result = await coreClient(env.CORE).getStorefrontHome({
      requestId,
      itemsPerRail: 12,
      ...catalogLocation,
    });
    return jsonWithRequestId(result, requestId, {
      status: result.ok ? 200 : 502,
      headers: { "cache-control": "private, no-store" },
    });
  }
  const category = url.searchParams.get("category");
  const result = await coreClient(env.CORE).searchCatalog({
    requestId,
    query: url.searchParams.get("q") ?? undefined,
    categorySlug: category && category.trim() !== "" ? category.trim() : undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: positiveIntParam(url.searchParams.get("limit"), DEFAULT_LIMIT),
    ...catalogLocation,
  });
  return jsonWithRequestId(result, requestId, {
    headers: { "cache-control": "private, no-store" },
    status: result.ok ? 200 : result.error.code === "VALIDATION_FAILED" ? 400 : 502,
  });
}
