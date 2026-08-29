import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function parseLimit(params: URLSearchParams): number | undefined | Response {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "limit must be an integer between 1 and 100",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return parsed;
}

/** Thin same-origin BFF adapter for the product list. Transport only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params);
  if (limit instanceof Response) return limit;
  const result = await coreClient(env.CORE).listAdminProducts({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    query: params.get("query") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit,
  });
  return Response.json(result);
}

/** Whitelisted Product creation adapter; Core remains authoritative for validation and writes. */
export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const customerDetails = body?.customerDetails;
  if (
    !idempotencyKey ||
    typeof body?.categoryId !== "string" ||
    typeof body.slug !== "string" ||
    typeof body.name !== "string" ||
    !(body.description === null || typeof body.description === "string") ||
    !Array.isArray(customerDetails) ||
    typeof body.inventoryBaseUnitId !== "string" ||
    !customerDetails.every(
      (detail) =>
        typeof detail === "object" &&
        detail !== null &&
        typeof (detail as Record<string, unknown>).label === "string" &&
        typeof (detail as Record<string, unknown>).value === "string" &&
        Number.isInteger((detail as Record<string, unknown>).sortOrder),
    )
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "Valid Product fields and an idempotency-key are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).createAdminProduct({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      categoryId: body.categoryId,
      slug: body.slug,
      name: body.name,
      description: body.description,
      customerDetails: customerDetails.map((detail) => {
        const record = detail as Record<string, unknown>;
        return {
          label: record.label as string,
          value: record.value as string,
          sortOrder: record.sortOrder as number,
        };
      }),
      inventoryBaseUnitId: body.inventoryBaseUnitId,
      idempotencyKey,
    }),
  );
}
