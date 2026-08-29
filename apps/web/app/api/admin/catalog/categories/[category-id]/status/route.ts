import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

type Context = { params: Promise<{ "category-id": string }> };

export async function POST(request: Request, context: Context) {
  const categoryId = (await context.params)["category-id"];
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !idempotencyKey ||
    (body?.status !== "active" && body?.status !== "inactive") ||
    typeof body.reason !== "string" ||
    body.reason.trim() === "" ||
    typeof body.expectedVersion !== "number" ||
    !Number.isInteger(body.expectedVersion)
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "status, reason, expectedVersion, and idempotency-key are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  return Response.json(
    await coreClient(env.CORE).setAdminCategoryStatus({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      categoryId,
      status: body.status,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    }),
  );
}
