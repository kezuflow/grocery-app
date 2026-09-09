import { env } from "cloudflare:workers";
import { releaseScheduledSurplusBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { readBoundedJson } from "@/lib/http/bounded-body";
export const POST = observeAdminRoute("admin.receiving.surplus.post", async (request: Request) => {
  const body = await readBoundedJson(request, releaseScheduledSurplusBodySchema, {
    maxBytes: 8192,
  });
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key")),
    requestId = webRequestId(request);
  if (!body.ok || !key.success)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "Review the inspected quantity and reason",
          requestId,
        },
      },
      { status: !body.ok ? body.error.status : 400 },
    );
  return adminJson(
    await coreClient(env.CORE).releaseScheduledSurplus({
      ...body.value,
      idempotencyKey: key.data,
      headers: requestHeaders(request),
      requestId,
    }),
  );
});
