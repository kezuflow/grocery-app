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

export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).getServiceFeeConfiguration({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("valid Service Fee configuration is required");
  try {
    return Response.json(
      await coreClient(env.CORE).updateServiceFeeConfiguration({
        requestId: crypto.randomUUID(),
        headers: requestHeaders(request),
        ...parsed.data,
        idempotencyKey: requireIdempotencyKey(request, parsed.data.idempotencyKey),
      }),
    );
  } catch (error) {
    return invalid((error as Error).message);
  }
}
