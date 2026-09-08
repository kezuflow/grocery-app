import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "invitation-id": string }> },
) {
  const { "invitation-id": invitationId } = await context.params;
  const key = z.string().trim().min(1).max(200).safeParse(request.headers.get("idempotency-key"));
  const body = z
    .object({
      reason: z.string().trim().min(1).max(500),
      expectedVersion: z.number().int().positive(),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!key.success || !body.success)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "A reason, current invitation version and request key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).revokeAdminStaffInvitation({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      invitationId,
      ...body.data,
      idempotencyKey: key.data,
    }),
  );
}
export const POST = observeAdminRoute(
  "admin.staff.invitations.by_invitation_id.revoke.post",
  POSTHandler,
);
