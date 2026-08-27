import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function queryValue(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value !== null && value.trim() !== "" ? value : undefined;
}

/**
 * Thin same-origin BFF adapter for the scoped Audit list. Capability/scope
 * enforcement, pagination bounds, and redaction happen in Core; this route
 * validates transport shape only.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limitParam = queryValue(params, "limit");
  let limit: number | undefined;
  if (limitParam !== undefined) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return Response.json(
        {
          ok: false as const,
          error: {
            code: "VALIDATION_FAILED" as const,
            message: "limit must be an integer between 1 and 100",
            requestId: crypto.randomUUID(),
          },
        },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const result = await coreClient(env.CORE).listAdminAuditEvents({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    action: queryValue(params, "action"),
    resourceType: queryValue(params, "resourceType"),
    actorId: queryValue(params, "actorId"),
    marketId: queryValue(params, "marketId"),
    locationId: queryValue(params, "locationId"),
    from: queryValue(params, "from"),
    to: queryValue(params, "to"),
    cursor: queryValue(params, "cursor"),
    limit,
  });
  return Response.json(result);
}
