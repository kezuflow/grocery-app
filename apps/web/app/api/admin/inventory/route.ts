import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams, requestId: string): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: requestId,
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Thin same-origin BFF adapter for location inventory. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationId = params.get("locationId");
  if (locationId === null || locationId.trim() === "") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "locationId is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminInventory({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    locationId,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.inventory.get", GETHandler);
