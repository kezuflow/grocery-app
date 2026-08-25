import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { requireIdempotencyKey } from "@/lib/core-client/commands";

const bodySchema = z.object({
  checkoutAttemptId: z.string().trim().min(1),
  returnUrl: z.string().url(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid payment request" } },
      { status: 400 },
    );
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch (error) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: (error as Error).message } },
      { status: 400 },
    );
  }
  // The browser never asserts success: the response is a pending action at
  // most, and order commitment originates solely from Core's Payments reaction.
  return Response.json(
    await coreClient(env.CORE).createPaymentIntent({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      checkoutAttemptId: parsed.data.checkoutAttemptId,
      returnUrl: parsed.data.returnUrl,
      idempotencyKey,
    }),
  );
}

export async function GET(request: Request) {
  return Response.json({
    ok: true,
    value: { providerConfigured: false },
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  });
}
