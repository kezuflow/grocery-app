import type { CoreServiceBinding } from "@freshmarkets/contracts";

type CatalogCore = Pick<CoreServiceBinding, "getMarketplaceHome" | "searchMarketplace">;

/** Wrangler does not infer the RPC method shape from a separate Worker config. */
function catalogCore(binding: Cloudflare.Env["CORE"]): CatalogCore {
  return binding as unknown as CatalogCore;
}

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && requestIdPattern.test(supplied) ? supplied : crypto.randomUUID();
}

function publicJson(body: unknown, status: number, id: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-request-id": id,
    },
  });
}

function invalid(id: string): Response {
  return publicJson({ ok: false, error: { code: "VALIDATION_FAILED" }, requestId: id }, 400, id);
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    const id = requestId(request);

    if (url.pathname === "/health" && request.method === "GET") {
      return publicJson({ status: "ok" }, 200, id);
    }
    if (url.pathname.startsWith("/v1/catalog/") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "x-request-id",
          "access-control-max-age": "600",
        },
      });
    }
    if (request.method !== "GET") {
      return publicJson(
        { ok: false, error: { code: "METHOD_NOT_ALLOWED" }, requestId: id },
        405,
        id,
      );
    }

    try {
      if (url.pathname === "/v1/catalog/home") {
        if (url.search) return invalid(id);
        const result = await catalogCore(env.CORE).getMarketplaceHome({
          requestId: id,
          itemsPerRail: 8,
        });
        return publicJson(result, result.ok ? 200 : 503, id);
      }
      if (url.pathname === "/v1/catalog/search") {
        const query = url.searchParams.get("q")?.trim() ?? "";
        const categorySlug = url.searchParams.get("category")?.trim() ?? "";
        if (
          query.length > 120 ||
          categorySlug.length > 80 ||
          [...url.searchParams.keys()].some((key) => key !== "q" && key !== "category")
        )
          return invalid(id);
        const result = await catalogCore(env.CORE).searchMarketplace({
          requestId: id,
          query: query || undefined,
          categorySlug: categorySlug || undefined,
          limit: 24,
        });
        return publicJson(result, result.ok ? 200 : 503, id);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "mobile_api.catalog_read_failed",
          requestId: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return publicJson(
        { ok: false, error: { code: "CATALOG_UNAVAILABLE" }, requestId: id },
        503,
        id,
      );
    }

    return publicJson({ ok: false, error: { code: "NOT_FOUND" }, requestId: id }, 404, id);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
