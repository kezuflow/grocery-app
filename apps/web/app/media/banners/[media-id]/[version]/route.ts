import { cachedPublicImage } from "@/lib/http/cached-public-image";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { webRequestId } from "@/lib/http/request-context";

export async function GET(
  request: Request,
  context: { params: Promise<{ "media-id": string; version: string }> },
) {
  const params = await context.params;
  const version = /^[1-9]\d*$/.test(params.version) ? Number(params.version) : NaN;
  if (!Number.isSafeInteger(version))
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return cachedPublicImage(request, async () => {
    const result = await coreClient(env.CORE).getPublishedBannerMedia({
      requestId: webRequestId(request),
      mediaId: params["media-id"],
      version,
    });
    if (!result.ok)
      return new Response(null, {
        status:
          result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION_FAILED"
            ? 404
            : 503,
        headers: { "cache-control": "no-store" },
      });
    const headers = {
      "content-type": result.value.mimeType,
      etag: result.value.etag,
      "x-content-type-options": "nosniff",
    };
    return new Response(result.value.bytes, { status: 200, headers });
  });
}
