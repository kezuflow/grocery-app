import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

const PRIVACY_STATUSES = [
  "SUBMITTED",
  "VERIFYING",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "COMPLETED",
  "ESCALATED",
] as const;

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

/** Thin same-origin BFF adapter for the privacy request queue. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const statusParam = params.get("status");
  if (statusParam !== null && !(PRIVACY_STATUSES as readonly string[]).includes(statusParam)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status is not a recognized privacy request state",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const status = statusParam as (typeof PRIVACY_STATUSES)[number] | null;
  const result = await coreClient(env.CORE).listPrivacyRequests({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    status: status ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.privacy_requests.get", GETHandler);
