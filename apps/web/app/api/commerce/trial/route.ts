import { env } from "cloudflare:workers";
import type { CoreServiceBinding } from "@freshmarkets/contracts";
import { requestHeaders } from "../../../../lib/core-client/request";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const result = await (env.CORE as unknown as CoreServiceBinding).startTrial({
    requestId,
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
