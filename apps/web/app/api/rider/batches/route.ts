import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/**
 * The authenticated Rider's assigned batches. Core resolves the canonical
 * Rider identity from the session; no client Rider identifier is accepted.
 */
export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).getRiderBatches({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}
