import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { z } from "@freshmarkets/validation";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** Revoke every Better Auth session for the staff user. Transport only. */
async function POSTHandler(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "" || idempotencyKey.length > 200) {
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
  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A reason is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).revokeAdminStaffSessions({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    staffId,
    reason: parsed.data.reason,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.staff.by_staff_id.sessions.revoke.post", POSTHandler);
