import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request) {
  const context = webRequestContext(request);
  return jsonWithRequestId(
    await coreClient(env.CORE).getCheckoutBootstrap({
      requestId: context.requestId,
      headers: context.coreHeaders,
    }),
    context.requestId,
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
