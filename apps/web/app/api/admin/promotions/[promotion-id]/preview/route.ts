import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Read-only preview: never claims usage or mutates state. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const body = (await request.json().catch(() => null)) as { subtotalMinor?: unknown } | null;
  if (!Number.isInteger(body?.subtotalMinor)) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An integer subtotalMinor is required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).previewAdminPromotion({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    promotionId,
    subtotalMinor: body!.subtotalMinor as number,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute("admin.promotions.by_promotion_id.preview.post", POSTHandler);
