import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Atomic staff scope replacement. Transport only; Core authorizes. */
async function PUTHandler(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
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
    scopes?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (!Array.isArray(body?.scopes) || !Number.isInteger(body?.expectedVersion)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "scopes (array) and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminStaffScopes({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
    scopes: body!.scopes as never,
    expectedVersion: body!.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const PUT = observeAdminRoute("admin.staff.by_staff_id.scopes.put", PUTHandler);
