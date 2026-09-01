import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "invitation-id": string }> },
) {
  const { "invitation-id": invitationId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  if (
    idempotencyKey.trim() === "" ||
    typeof body?.reason !== "string" ||
    body.reason.trim() === ""
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "A reason and idempotency-key header are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).revokeAdminStaffInvitation({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    invitationId,
    reason: body.reason.trim(),
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.staff.invitations.by_invitation_id.revoke.post",
  POSTHandler,
);
