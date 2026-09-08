import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
type Context = { params: Promise<{ "customer-id": string }> };
export const GET = observeAdminRoute(
  "admin.customers.profile.get",
  async (request: Request, context: Context) => {
    const { "customer-id": customerId } = await context.params;
    return adminJson(
      await coreClient(env.CORE).getAdminCustomerProfile({
        customerId,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
const schema = z
  .object({
    preferredLanguage: z.string().trim().min(1).max(80).nullable(),
    promotionalEmails: z.boolean(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const POST = observeAdminRoute(
  "admin.customers.profile.update",
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
            message: "Valid preferences, reason and request key are required",
            requestId: webRequestId(request),
          },
        },
        { status: 400 },
      );
    return adminJson(
      await coreClient(env.CORE).updateAdminCustomerProfile({
        ...parsed.data,
        customerId,
        idempotencyKey,
        headers: requestHeaders(request),
        requestId: webRequestId(request),
      }),
    );
  },
);
