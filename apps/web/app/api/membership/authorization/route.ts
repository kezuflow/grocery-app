import { env } from "cloudflare:workers";
import { requestHeaders } from "@/lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

// Establishes the recurring-capable payment authorization required before the
// introductory trial (D2). The response carries the provider instrument-
// collection action; it is never payment success.
export async function POST(request: Request): Promise<Response> {
  let idempotencyKey: string;
  try {
    idempotencyKey = await Promise.resolve(requireIdempotencyKey(request));
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const result = await coreClient(env.CORE).beginRecurringAuthorization({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    returnUrl: `${url.origin}/account`,
    idempotencyKey,
  });
  return Response.json(result);
}
