import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** The closed canonical capability vocabulary. Transport only. */
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).listCapabilityDefinitions({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result);
}
