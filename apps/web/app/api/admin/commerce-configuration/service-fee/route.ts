import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid } from "../../operations-route-utils";

const schema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  feeType: z.enum(["FLAT", "PERCENTAGE", "MIXED"]),
  flatMinor: z.number().int().nonnegative(),
  percentageBasisPoints: z.number().int().nonnegative().max(10_000),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  effectiveFrom: z.string().datetime(),
  reason: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1).optional(),
});

async function GETHandler(request: Request) {
  return adminJson(
    await coreClient(env.CORE).getServiceFeeConfiguration({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
    }),
  );
}

async function POSTHandler(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(request, "valid Service Fee configuration is required");
  try {
    return adminJson(
      await coreClient(env.CORE).updateServiceFeeConfiguration({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        ...parsed.data,
        idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
      }),
    );
  } catch (error) {
    return invalid(request, (error as Error).message);
  }
}

export const GET = observeAdminRoute("admin.commerce_configuration.service_fee.get", GETHandler);

export const POST = observeAdminRoute("admin.commerce_configuration.service_fee.post", POSTHandler);
