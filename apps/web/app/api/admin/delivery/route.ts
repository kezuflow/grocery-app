import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey, requireExpectedVersion } from "@/lib/core-client/commands";

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
  action: z.enum(["START", "PACK", "SHORTAGE", "DISPATCH", "DELIVER", "FAIL"]),
});

/** Staff fulfillment/delivery command route. Authorization happens in Core IAM. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid delivery command" } },
      { status: 400 },
    );
  let idempotencyKey: string;
  let expectedVersion: number;
  try {
    idempotencyKey = requireIdempotencyKey(request);
    expectedVersion = requireExpectedVersion(
      new URL(request.url).searchParams.get("v") ?? undefined,
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
      { status: 400 },
    );
  }
  const common = {
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    idempotencyKey,
    expectedVersion,
  };
  const core = coreClient(env.CORE);
  const result =
    parsed.data.action === "START" ||
    parsed.data.action === "PACK" ||
    parsed.data.action === "SHORTAGE"
      ? await core.advanceFulfillment({
          ...common,
          orderId: parsed.data.orderId,
          action: parsed.data.action,
        })
      : await core.advanceDelivery({
          ...common,
          orderId: parsed.data.orderId,
          action: parsed.data.action as "DISPATCH" | "DELIVER" | "FAIL",
        });
  return Response.json(result);
}
