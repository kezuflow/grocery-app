import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapters for the unit registry. Transport only. */
async function GETHandler(request: Request) {
  const result = await coreClient(env.CORE).listAdminUnits({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  });
  return adminJson(result);
}

async function POSTHandler(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (idempotencyKey.trim() === "") {
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "An idempotency-key header is required",
          requestId: webRequestId(request),
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
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message:
            "Canonical unit code, display name, dimension, base, and conversion are required",
          requestId: webRequestId(request),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).createAdminUnit({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    code: body.code,
    displayName: body.displayName,
    dimension: body.dimension,
    canonicalBaseCode: body.canonicalBaseCode,
    conversionNumerator: body.conversionNumerator as number,
    conversionDenominator: body.conversionDenominator as number,
    idempotencyKey,
  });
  return adminJson(result);
}

export const GET = observeAdminRoute("admin.catalog.units.get", GETHandler);

export const POST = observeAdminRoute("admin.catalog.units.post", POSTHandler);
