import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapters for the unit registry. Transport only. */
export async function GET(request: Request) {
  const result = await coreClient(env.CORE).listAdminUnits({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
  });
  return Response.json(result);
}

export async function POST(request: Request) {
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
    typeof body?.code !== "string" ||
    typeof body?.displayName !== "string" ||
    (body?.dimension !== "MASS" && body?.dimension !== "COUNT" && body?.dimension !== "VOLUME") ||
    (body?.canonicalBaseCode !== "GRAM" &&
      body?.canonicalBaseCode !== "MILLILITER" &&
      body?.canonicalBaseCode !== "PIECE") ||
    !Number.isInteger(body?.conversionNumerator) ||
    !Number.isInteger(body?.conversionDenominator)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "Canonical unit code, display name, dimension, base, and conversion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminUnit({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    code: body.code,
    displayName: body.displayName,
    dimension: body.dimension,
    canonicalBaseCode: body.canonicalBaseCode,
    conversionNumerator: body.conversionNumerator as number,
    conversionDenominator: body.conversionDenominator as number,
    idempotencyKey,
  });
  return Response.json(result);
}
