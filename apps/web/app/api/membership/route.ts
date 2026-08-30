import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request): Promise<Response> {
  const context = webRequestContext(request);
  const result = await coreClient(env.CORE).getMembershipExperience({
    requestId: context.requestId,
    headers: context.coreHeaders,
  });
  return jsonWithRequestId(result, context.requestId);
}
