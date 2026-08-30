import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request): Promise<Response> {
  const context = webRequestContext(request);
  const result = await coreClient(env.CORE).getApplicationContext({
    headers: context.coreHeaders,
    requestId: context.requestId,
  });
  return jsonWithRequestId(result, context.requestId);
}
