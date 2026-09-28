import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";
import { z } from "@freshmarkets/validation";

const querySchema = z.object({ cursor: z.string().min(1).max(2048).optional() });

export async function GET(request: Request) {
  const context = webRequestContext(request);
  const parsed = querySchema.safeParse({
    cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success)
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid checkout page",
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  return jsonWithRequestId(
    await coreClient(env.CORE).listCustomerIncompleteCheckouts({
      requestId: context.requestId,
      headers: context.coreHeaders,
      cursor: parsed.data.cursor,
    }),
    context.requestId,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
