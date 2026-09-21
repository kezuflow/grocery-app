import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

const querySchema = z.object({ paymentIntentId: z.string().trim().min(1).max(200) });

export async function GET(request: Request) {
  const context = webRequestContext(request);
  const parsed = querySchema.safeParse({
    paymentIntentId: new URL(request.url).searchParams.get("paymentIntentId"),
  });
  if (!parsed.success)
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "A valid payment intent is required",
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );

  return jsonWithRequestId(
    await coreClient(env.CORE).getCheckoutPaymentCompletion({
      requestId: context.requestId,
      headers: context.coreHeaders,
      paymentIntentId: parsed.data.paymentIntentId,
    }),
    context.requestId,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
