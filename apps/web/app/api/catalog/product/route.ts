import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { requestId } = webRequestContext(request);
  const slug = url.searchParams.get("slug");
  if (!slug)
    return jsonWithRequestId(
      { error: { code: "VALIDATION_FAILED", message: "slug is required", requestId } },
      requestId,
      { status: 400 },
    );
  const result = await coreClient(env.CORE).getCatalogProduct({
    requestId,
    slug,
  });
  return jsonWithRequestId(result, requestId);
}
