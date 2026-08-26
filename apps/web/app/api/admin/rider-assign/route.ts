import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey, requireExpectedVersion } from "@/lib/core-client/commands";

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
  riderAuthUserId: z.string().trim().min(1),
});

/** Assign an open delivery job to an active staff rider. Core enforces scope. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid rider assignment" } },
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
  return Response.json(
    await coreClient(env.CORE).assignRider({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      orderId: parsed.data.orderId,
      riderAuthUserId: parsed.data.riderAuthUserId,
      expectedVersion,
      idempotencyKey,
    }),
  );
}
