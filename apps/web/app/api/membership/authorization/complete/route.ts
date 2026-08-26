import { env } from "cloudflare:workers";
import { requestHeaders } from "@/lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";

// Confirms the pending recurring authorization from a verified provider
// lookup after the customer returns from instrument collection.
export async function POST(request: Request): Promise<Response> {
  let authorizationId: unknown;
  try {
    const body = (await request.json()) as { authorizationId?: unknown };
    authorizationId = body.authorizationId;
  } catch {
    authorizationId = undefined;
  }
  if (typeof authorizationId !== "string" || authorizationId.trim() === "") {
    return Response.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "authorizationId is required" },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).completeRecurringAuthorization({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    authorizationId,
  });
  return Response.json(result);
}
