import { adminCategoryUpdateBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type Context = { params: Promise<{ "category-id": string }> };

async function GETHandler(request: Request, context: Context) {
  const categoryId = (await context.params)["category-id"];
  return adminJson(
    await coreClient(env.CORE).getAdminCategory({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      categoryId,
    }),
  );
}

async function PATCHHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminCategoryUpdateBodySchema, { maxBytes: 16384 });
  if (!key.success || !body.ok)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: !body.ok ? body.error.message : "An idempotency-key header is required",
          requestId: webRequestId(request),
        },
      },
      { status: !body.ok ? body.error.status : 400 },
    );
  return adminJson(
    await coreClient(env.CORE).updateAdminCategory({
      ...body.value,
      categoryId: (await context.params)["category-id"],
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}
export const GET = observeAdminRoute("admin.catalog.categories.by_category_id.get", GETHandler);

export const PATCH = observeAdminRoute(
  "admin.catalog.categories.by_category_id.patch",
  PATCHHandler,
);
