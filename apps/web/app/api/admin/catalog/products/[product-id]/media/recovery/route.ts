import { env } from "cloudflare:workers";
import { z, productMediaRecoveryActionSchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { readBoundedJson } from "@/lib/http/bounded-body";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "product-id": string }> };
export const GET = observeAdminRoute(
  "admin.catalog.media.recovery.get",
  async (request: Request, context: Context) => {
    const { "product-id": productId } = await context.params;
    return adminJson(
      await coreClient(env.CORE).getAdminProductMediaRecovery({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        productId,
        cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
      }),
    );
  },
);
export const POST = observeAdminRoute(
  "admin.catalog.media.recovery.post",
  async (request: Request, context: Context) => {
    const { "product-id": productId } = await context.params;
    const body = await readBoundedJson(
      request,
      z.object({
        itemId: z.string().min(1),
        action: productMediaRecoveryActionSchema,
        expectedVersion: z.number().int().safe().positive(),
        reason: z.string().trim().min(1).max(500),
      }),
      { maxBytes: 4096 },
    );
    if (!body.ok)
      return adminJson(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: body.error.message,
            requestId: webRequestId(request),
          },
        },
        { status: body.error.status },
      );
    return adminJson(
      await coreClient(env.CORE).recoverAdminProductMedia({
        ...body.value,
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        productId,
        idempotencyKey: request.headers.get("idempotency-key") ?? "",
      }),
    );
  },
);
