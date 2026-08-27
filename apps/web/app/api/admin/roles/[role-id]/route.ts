import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Thin same-origin BFF adapter for one role. Transport only. */
export async function GET(request: Request, context: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = await context.params;
  const result = await coreClient(env.CORE).getAdminRole({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    roleId,
  });
  return Response.json(result);
}

/** Rename or re-describe an ACTIVE role. Transport only; Core authorizes. */
export async function PATCH(request: Request, context: { params: Promise<{ "role-id": string }> }) {
  const { "role-id": roleId } = await context.params;
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
    name?: unknown;
    description?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    typeof body?.name !== "string" ||
    typeof body?.description !== "string" ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "name, description, and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).updateAdminRole({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    roleId,
    name: body.name,
    description: body.description,
    expectedVersion: body.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
