import { env } from "cloudflare:workers";
import type { ServiceabilityRequest } from "@freshmarkets/contracts";
import { coreClient } from "@/lib/core-client/core";

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const input = (await request.json().catch(() => null)) as Omit<
    ServiceabilityRequest,
    "requestId"
  > | null;
  if (!input || typeof input.latitude !== "number" || typeof input.longitude !== "number") {
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Latitude and longitude numbers are required.",
          requestId,
        },
      },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const result = await coreClient(env.CORE).resolveServiceability({
    ...input,
    requestId,
  });
  const responseRequestId = result.ok ? result.requestId : result.error.requestId;
  return Response.json(result, { headers: { "x-request-id": responseRequestId } });
}
