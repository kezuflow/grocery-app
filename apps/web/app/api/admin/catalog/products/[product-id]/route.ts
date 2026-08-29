import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one product detail. */
export async function GET(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
  const params = new URL(request.url).searchParams;
  const result = await coreClient(env.CORE).getAdminProduct({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    productId,
    marketId: params.get("marketId") ?? undefined,
    locationId: params.get("locationId") ?? undefined,
  });
  return Response.json(result);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
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
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion) ||
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
          message: "Valid Product fields, expectedVersion, and idempotency-key are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).updateAdminProduct({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      productId,
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
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    }),
  );
}
