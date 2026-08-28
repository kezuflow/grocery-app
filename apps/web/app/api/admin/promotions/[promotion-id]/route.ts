import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one promotion definition. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
  const result = await coreClient(env.CORE).getAdminPromotion({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    promotionId,
  });
  return Response.json(result);
}

/** Draft-definition update. Transport only; Core owns the lifecycle rules. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ "promotion-id": string }> },
) {
  const { "promotion-id": promotionId } = await context.params;
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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    typeof body?.name !== "string" ||
    !Number.isInteger(body?.minimumMinor) ||
    typeof body?.startsAt !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "name, minimumMinor, startsAt, and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminPromotion({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    promotionId,
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    discountMinor: typeof body.discountMinor === "number" ? body.discountMinor : undefined,
    percent: typeof body.percent === "number" ? body.percent : undefined,
    minimumMinor: body.minimumMinor as number,
    startsAt: body.startsAt,
    endsAt: typeof body.endsAt === "string" ? body.endsAt : null,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
