import { adminCategoryCreateBodySchema, idempotencyKeySchema } from "@freshmarkets/validation";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapters for categories. Transport only. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const limitRaw = params.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
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
  }
  const status = params.get("status");
  if (status !== null && status !== "active" && status !== "inactive") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status must be active or inactive",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).listAdminCategories({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    query: params.get("query") ?? undefined,
    status: status ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return adminJson(result);
}

async function POSTHandler(request: Request) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, adminCategoryCreateBodySchema, { maxBytes: 16384 });
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
    await coreClient(env.CORE).createAdminCategory({
      ...body.value,
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      idempotencyKey: key.data,
    }),
  );
}
export const GET = observeAdminRoute("admin.catalog.categories.get", GETHandler);

export const POST = observeAdminRoute("admin.catalog.categories.post", POSTHandler);
