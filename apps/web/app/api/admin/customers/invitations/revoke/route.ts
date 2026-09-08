import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";

const schema = z.object({
  invitationId: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
export const POST = observeAdminRoute(
  "admin.customer.invitation.revoke",
  async (request: Request) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200)
      return adminJson(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "A current invitation and request key are required",
            requestId: webRequestId(request),
          },
        },
        { status: 400 },
      );
    return adminJson(
      await coreClient(env.CORE).revokeCustomerInvitation({
        ...parsed.data,
        idempotencyKey,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
