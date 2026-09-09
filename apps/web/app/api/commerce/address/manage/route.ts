import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { webRequestId } from "@/lib/http/request-context";
import { adminJson } from "@/lib/http/admin-route-observability";

const schema = z
  .object({
    action: z.enum(["SET_DEFAULT", "REMOVE"]),
    addressId: z.string().min(1).max(200),
    expectedAddressVersion: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  const requestId = webRequestId(request);
  if (!parsed.success || !idempotencyKey || idempotencyKey.length > 200)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Choose an address and current version",
          requestId,
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).manageMyCustomerAddress({
      ...parsed.data,
      idempotencyKey,
      headers: requestHeaders(request),
      requestId,
    }),
  );
}
