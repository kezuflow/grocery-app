import { env } from "cloudflare:workers";
import { saveStorefrontBannerBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { requestHeaders } from "@/lib/core-client/request";
import { coreClient } from "@/lib/core-client/core";
export const GET = observeAdminRoute("admin.banners.list", async (request: Request) =>
  adminJson(
    await coreClient(env.CORE).listAdminBanners({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  ),
);
export const POST = observeAdminRoute("admin.banners.save", async (request: Request) => {
  const body = await readBoundedJson(request, saveStorefrontBannerBodySchema, { maxBytes: 8192 });
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!body.ok || !key.success)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Review banner details",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).saveAdminBanner({
      ...body.value,
      idempotencyKey: key.data,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  );
});
