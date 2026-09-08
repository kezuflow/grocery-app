import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "customer-id": string }> };
const querySchema = z.object({
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const GET = observeAdminRoute(
  "admin.customers.notes.list",
  async (request: Request, context: Context) => {
    const { "customer-id": customerId } = await context.params;
    const params = new URL(request.url).searchParams;
    const query = querySchema.safeParse({
      cursor: params.get("cursor") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!query.success)
      return adminJson(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid notes page",
            requestId: webRequestId(request),
          },
        },
        { status: 400 },
      );
    return adminJson(
      await coreClient(env.CORE).listCustomerSupportNotes({
        ...query.data,
        customerId,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
const schema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();
export const POST = observeAdminRoute(
  "admin.customers.notes.append",
  async (request: Request, context: Context) => {
    const { "customer-id": customerId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200)
      return adminJson(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "A note of at most 2000 characters and request key are required",
            requestId: webRequestId(request),
          },
        },
        { status: 400 },
      );
    return adminJson(
      await coreClient(env.CORE).appendCustomerSupportNote({
        ...parsed.data,
        customerId,
        idempotencyKey,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
