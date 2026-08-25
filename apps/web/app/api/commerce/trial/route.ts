import { env } from "cloudflare:workers";
import { requestHeaders } from "../../../../lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const result = await coreClient(env.CORE).startTrial({
    requestId,
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
