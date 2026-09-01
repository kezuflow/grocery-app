import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type Context = { params: Promise<{ "category-id": string }> };

async function POSTHandler(request: Request, context: Context) {
  const categoryId = (await context.params)["category-id"];
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !idempotencyKey ||
    (body?.status !== "active" && body?.status !== "inactive") ||
    typeof body.reason !== "string" ||
    body.reason.trim() === "" ||
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion)
  ) {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status, reason, expectedVersion, and idempotency-key are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  return adminJson(
    await coreClient(env.CORE).setAdminCategoryStatus({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      categoryId,
      status: body.status,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    }),
  );
}

export const POST = observeAdminRoute(
  "admin.catalog.categories.by_category_id.status.post",
  POSTHandler,
);
