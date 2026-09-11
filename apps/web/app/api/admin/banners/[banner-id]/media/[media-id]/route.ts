import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
export async function GET(
  request: Request,
  context: { params: Promise<{ "banner-id": string; "media-id": string }> },
) {
  const params = await context.params;
  const result = await coreClient(env.CORE).getAdminBannerMediaContent({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    bannerId: params["banner-id"],
    mediaId: params["media-id"],
  });
  if (!result.ok)
    return new Response(null, {
      status:
        result.error.code === "UNAUTHENTICATED"
          ? 401
          : result.error.code === "FORBIDDEN"
            ? 403
            : 404,
      headers: { "cache-control": "no-store" },
    });
  return new Response(result.value.bytes, {
    headers: {
      "content-type": result.value.mimeType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
