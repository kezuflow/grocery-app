import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type RouteContext = {
  params: Promise<{ "product-id": string; "media-id": string }>;
};

/** Authenticated same-origin media adapter; internal R2 identity stays in Core. */
async function GETHandler(request: Request, context: RouteContext) {
  const { "product-id": productId, "media-id": mediaId } = await context.params;
  const result = await coreClient(env.CORE).getAdminProductMediaContent({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    productId,
    mediaId,
  });
  if (!result.ok) {
    const status =
      result.error.code === "UNAUTHENTICATED"
        ? 401
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code === "NOT_FOUND"
            ? 404
            : 400;
    return adminJson(result, { status });
  }
  const headers = {
    "cache-control": "private, max-age=300, must-revalidate",
    "content-type": result.value.mimeType,
    etag: result.value.etag,
    "x-content-version": String(result.value.version),
  };
  if (request.headers.get("if-none-match") === result.value.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(result.value.bytes, { status: 200, headers });
}

export const GET = observeAdminRoute(
  "admin.catalog.products.by_product_id.media.by_media_id.content.get",
  GETHandler,
);
