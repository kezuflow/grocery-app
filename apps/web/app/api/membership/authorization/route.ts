import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

// Establishes the recurring-capable payment authorization required before the
// introductory trial (D2). The response carries the provider instrument-
// collection action; it is never payment success.
export async function POST(request: Request): Promise<Response> {
  const context = webRequestContext(request);
  let idempotencyKey: string;
  try {
    idempotencyKey = await Promise.resolve(requireIdempotencyKey(request));
  } catch (error) {
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: (error as Error).message,
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400 },
    );
  }
  const url = new URL(request.url);
  const result = await coreClient(env.CORE).beginRecurringAuthorization({
    requestId: context.requestId,
    headers: context.coreHeaders,
    returnUrl: `${url.origin}/account`,
    idempotencyKey,
  });
  return jsonWithRequestId(result, context.requestId);
}
