import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).listAdminPaymentAttention({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      cursor: params.get("cursor") ?? undefined,
      limit,
    }),
  );
}
export const GET = observeAdminRoute("admin.payments.attention.get", GETHandler);
