import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Atomic staff role replacement. Transport only; Core authorizes. */
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
    roleIds?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    !Array.isArray(body?.roleIds) ||
    !body!.roleIds.every((id) => typeof id === "string") ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "roleIds (string array) and integer expectedVersion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminStaffRoles({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
    roleIds: body!.roleIds as string[],
    expectedVersion: body!.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const PUT = observeAdminRoute("admin.staff.by_staff_id.roles.put", PUTHandler);
