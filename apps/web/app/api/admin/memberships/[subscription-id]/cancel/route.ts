import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Membership CANCEL through the canonical command. Transport only. */
export async function POST(
  request: Request,
  context: { params: Promise<{ "subscription-id": string }> },
) {
  const { "subscription-id": subscriptionId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    reason?: unknown;
    expectedVersion?: unknown;
    timing?: unknown;
  } | null;
  if (typeof body?.reason !== "string" || !Number.isInteger(body?.expectedVersion)) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "reason and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const timing =
    body.timing === "IMMEDIATE" || body.timing === "PERIOD_END" ? body.timing : undefined;
  const result = await coreClient(env.CORE).cancelAdminMembership({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    subscriptionId,
    reason: body.reason,
    expectedVersion: body.expectedVersion as number,
    timing,
    idempotencyKey,
  });
  return Response.json(result);
}
