import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one staff identity. Transport only. */
export async function GET(request: Request, context: { params: Promise<{ "staff-id": string }> }) {
  const { "staff-id": staffId } = await context.params;
  const result = await coreClient(env.CORE).getAdminStaff({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    staffId,
  });
  return Response.json(result);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ "staff-id": string }> },
) {
  const { "staff-id": staffId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    idempotencyKey.trim() === "" ||
    typeof body?.displayName !== "string" ||
    body.displayName.trim() === "" ||
    !Number.isInteger(body.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "displayName, integer expectedVersion, and idempotency-key are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminStaff({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    staffId,
    displayName: body.displayName.trim(),
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
