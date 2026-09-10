import { env } from "cloudflare:workers";
import { customerProfileRequestSchema } from "@/lib/core-client/profile-request";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";

export async function GET(request: Request) {
  return adminJson(
    await coreClient(env.CORE).getMyCustomerProfile({
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
}
export const POST = observeAdminRoute("customer.profile.update", async (request: Request) => {
  const parsed = customerProfileRequestSchema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Valid preferences and a request key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).updateMyCustomerProfile({
      ...parsed.data,
      idempotencyKey,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
