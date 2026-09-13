import { cachedPublicImage } from "@/lib/http/cached-public-image";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { webRequestId } from "@/lib/http/request-context";

export async function GET(
  request: Request,
  context: { params: Promise<{ "media-id": string; version: string }> },
) {
  const widthParam = new URL(request.url).searchParams.get("width");
  const width = widthParam === null ? null : Number(widthParam);
  if (width !== null && ![480, 960, 1440].includes(width))
    return new Response(null, { status: 400, headers: { "cache-control": "no-store" } });
  const params = await context.params;
  const version = /^[1-9]\d*$/.test(params.version) ? Number(params.version) : NaN;
  if (!Number.isSafeInteger(version))
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return cachedPublicImage(
    request,
    async () => {
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
      if (width !== null) {
        try {
          const stream = new Blob([result.value.bytes]).stream();
          const output = await env.IMAGES.input(stream)
            .transform({ width, fit: "scale-down" })
            .output({ format: "image/webp", quality: 85 });
          return output.response({
            headers: {
              etag: `"${params["media-id"]}-${version}-${width}-webp-85"`,
              "x-content-type-options": "nosniff",
            },
          });
        } catch {
          return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
        }
      }
      const headers = {
        "content-type": result.value.mimeType,
        etag: result.value.etag,
        "x-content-type-options": "nosniff",
      };
      return new Response(result.value.bytes, { status: 200, headers });
    },
    width === null ? undefined : `${width}-webp-85`,
  );
}
