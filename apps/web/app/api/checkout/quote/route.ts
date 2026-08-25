import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const bodySchema = z.object({
  cartId: z.string().trim().min(1),
  cartVersion: z.coerce.number().int().positive(),
  addressId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid quote request" } },
      { status: 400 },
    );
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).createCheckoutQuote({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      cartId: parsed.data.cartId,
      cartVersion: parsed.data.cartVersion,
      addressId: parsed.data.addressId,
      deliveryCycleId: parsed.data.cycleId,
      idempotencyKey,
    }),
  );
}
