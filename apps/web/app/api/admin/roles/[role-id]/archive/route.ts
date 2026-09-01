import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Archive a role with a required reason. Transport only; Core authorizes. */
async function POSTHandler(request: Request, context: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = await context.params;
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
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (typeof body?.reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "reason and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).archiveAdminRole({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    roleId,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.roles.by_role_id.archive.post", POSTHandler);
