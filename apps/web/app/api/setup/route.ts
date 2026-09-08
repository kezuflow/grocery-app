import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";

export const POST = observeAdminRoute("staff.initialAdministrator", async (request: Request) => {
  const input = z
    .object({ expectedVersion: z.literal(0) })
    .strict()
    .safeParse(await request.json().catch(() => null));
  const key = z.string().trim().min(1).max(200).safeParse(request.headers.get("idempotency-key"));
  if (!input.success || !key.success)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "A current setup request and request key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).completeInitialAdministratorSetup({
      ...input.data,
      idempotencyKey: key.data,
      headers: requestHeaders(request),
      requestId: webRequestId(request),
    }),
  );
});
