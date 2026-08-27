import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Atomic role capability replacement. Transport only; Core authorizes. */
export async function PUT(request: Request, context: { params: Promise<{ "role-id": string }> }) {
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
    capabilityCodes?: unknown;
    expectedVersion?: unknown;
  } | null;
  if (
    !Array.isArray(body?.capabilityCodes) ||
    !body!.capabilityCodes.every((code) => typeof code === "string") ||
    !Number.isInteger(body?.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "capabilityCodes (string array) and integer expectedVersion are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).setAdminRoleCapabilities({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    roleId,
    capabilityCodes: body!.capabilityCodes as import("@freshmarkets/contracts").Capability[],
    expectedVersion: body!.expectedVersion as number,
    idempotencyKey,
  });
  return Response.json(result);
}
