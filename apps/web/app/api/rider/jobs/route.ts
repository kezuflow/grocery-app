import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey, requireExpectedVersion } from "@/lib/core-client/commands";

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
  action: z.enum([
    "MARK_EN_ROUTE",
    "MARK_ARRIVED",
    "MARK_DELIVERED",
    "MARK_FAILED",
    "SCHEDULE_RETRY",
    "ESCALATE",
    "CANCEL",
  ]),
});

/**
 * The requesting rider's own open jobs. Core resolves the session and
 * returns only assignments belonging to that rider.
 *
 * @deprecated Historical raw job-list projection retained only while Web
 * callers migrate to GET /api/rider/batches. Its behavior remains unchanged.
 */
export async function GET(request: Request) {
  return Response.json(
    await coreClient(env.CORE).riderJobs({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
    }),
  );
}

/**
 * Rider console command route. Riders may act only on their assigned jobs;
 * assignment and location scoping are enforced by Core IAM before any effect.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid rider command" } },
      { status: 400 },
    );
  let idempotencyKey: string;
  let expectedVersion: number;
  try {
    idempotencyKey = requireIdempotencyKey(request);
    const url = new URL(request.url);
    expectedVersion = requireExpectedVersion(url.searchParams.get("v") ?? undefined);
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).advanceDelivery({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      idempotencyKey,
      expectedVersion,
      orderId: parsed.data.orderId,
      action: parsed.data.action,
    }),
  );
}
