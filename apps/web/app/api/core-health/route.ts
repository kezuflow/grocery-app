import { env } from "cloudflare:workers";
import { getCoreHealth } from "@/lib/core-client/health";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request): Promise<Response> {
  const { requestId } = webRequestContext(request);
  const health = await getCoreHealth(coreClient(env.CORE), requestId);

  return jsonWithRequestId(health, requestId);
}
