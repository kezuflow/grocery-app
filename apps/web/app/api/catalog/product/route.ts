import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const slug = url.searchParams.get("slug");
  if (!slug) return Response.json({ error: "slug is required" }, { status: 400 });
  const result = await coreClient(env.CORE).getCatalogProduct({
    requestId,
    slug,
  });
  return Response.json(result, { headers: { "x-request-id": requestId } });
}
