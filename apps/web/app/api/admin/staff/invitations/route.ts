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

/** Thin same-origin BFF adapter for the invitation queue. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params, webRequestId(request));
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminStaffInvitations({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

/** Invitation creation: no password input ever reaches this route. */
async function POSTHandler(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    displayName?: unknown;
  } | null;
  if (typeof body?.email !== "string" || typeof body?.displayName !== "string") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "email and displayName are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).inviteAdminStaff({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    email: body.email,
    displayName: body.displayName,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.staff.invitations.get", GETHandler);

export const POST = observeAdminRoute("admin.staff.invitations.post", POSTHandler);
