import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type MediaRouteContext = {
  params: Promise<{ "product-id": string; "media-id": string }>;
};

function invalid(message: string): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: crypto.randomUUID() },
    },
    { status: 400 },
  );
}

export async function PATCH(request: Request, context: MediaRouteContext) {
  const { "product-id": productId, "media-id": mediaId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !idempotencyKey ||
    typeof body?.altText !== "string" ||
    body.altText.trim() === "" ||
    typeof body.isPrimary !== "boolean" ||
    !Number.isInteger(body.sortOrder) ||
    (body.sortOrder as number) < 0 ||
    !Number.isInteger(body.expectedProductVersion) ||
    (body.expectedProductVersion as number) < 1
  ) {
    return invalid(
      "Alt text, primary flag, sort order, expected Product version, and idempotency-key are required",
    );
  }
  return Response.json(
    await coreClient(env.CORE).updateAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      productId,
      mediaId,
      altText: body.altText.trim(),
      isPrimary: body.isPrimary,
      sortOrder: body.sortOrder as number,
      expectedProductVersion: body.expectedProductVersion as number,
      idempotencyKey,
    }),
  );
}

export async function DELETE(request: Request, context: MediaRouteContext) {
  const { "product-id": productId, "media-id": mediaId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !idempotencyKey ||
    !Number.isInteger(body?.expectedProductVersion) ||
    (body?.expectedProductVersion as number) < 1
  ) {
    return invalid("Expected Product version and idempotency-key are required");
  }
  return Response.json(
    await coreClient(env.CORE).removeAdminProductMedia({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      productId,
      mediaId,
      expectedProductVersion: body!.expectedProductVersion as number,
      idempotencyKey,
    }),
  );
}
