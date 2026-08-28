import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Open an auditable privacy/closure request. Transport only. */
export async function POST(
  request: Request,
  context: { params: Promise<{ "customer-id": string }> },
) {
  const { "customer-id": customerId } = await context.params;
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
    requestType?: unknown;
    reason?: unknown;
  } | null;
  if (
    (body?.requestType !== "ACCESS" &&
      body?.requestType !== "CORRECTION" &&
      body?.requestType !== "CLOSURE" &&
      body?.requestType !== "ANONYMIZATION") ||
    typeof body?.reason !== "string"
  ) {
    return Response.json(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "requestType and reason are required",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 400 },
    );
  }
  const result = await coreClient(env.CORE).requestCustomerClosure({
    requestId: crypto.randomUUID(),
    headers: requestHeaders(request),
    customerId,
    requestType: body.requestType as "ACCESS" | "CORRECTION" | "CLOSURE" | "ANONYMIZATION",
    reason: body.reason,
    idempotencyKey,
  });
  return Response.json(result);
}
