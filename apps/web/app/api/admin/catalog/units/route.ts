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
    typeof body?.name !== "string" ||
    (body?.dimension !== "MASS" && body?.dimension !== "COUNT" && body?.dimension !== "VOLUME") ||
    typeof body?.symbol !== "string"
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "code, name, dimension, and symbol are required",
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
    name: body.name,
    dimension: body.dimension,
    symbol: body.symbol,
    idempotencyKey,
  });
  return Response.json(result);
}
