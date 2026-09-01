import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function validationFailure(message: string, requestId: string) {
  return adminJson(
    {
      ok: false as const,
      error: {
        code: "VALIDATION_FAILED" as const,
        message,
        requestId,
      },
    },
    { status: 400 },
  );
}

/** Activate or suspend a staff identity. Transport only; Core authorizes. */
async function POSTHandler(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "")
    return validationFailure("An idempotency-key header is required", webRequestId(request));
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    (body?.action !== "ACTIVATE" && body?.action !== "SUSPEND") ||
    typeof body?.reason !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return validationFailure(
      "action, reason, and integer expectedVersion are required",
      webRequestId(request),
    );
  }
  const result = await coreClient(env.CORE).changeAdminStaffAccess({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
    action: body.action as "ACTIVATE" | "SUSPEND",
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.staff.by_staff_id.access.post", POSTHandler);
