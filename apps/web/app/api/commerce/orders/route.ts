import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";
export async function GET(request: Request) {
  const context = webRequestContext(request);
  const params = new URL(request.url).searchParams;
  const filter = params.get("filter");
  if (filter !== null && filter !== "all" && filter !== "active" && filter !== "completed") {
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid order filter",
          requestId: context.requestId,
        },
      },
      context.requestId,
      { status: 400 },
    );
  }
  return jsonWithRequestId(
    await coreClient(env.CORE).listCustomerOrders({
      requestId: context.requestId,
      headers: context.coreHeaders,
      cursor: params.get("cursor") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      filter: filter ?? undefined,
    }),
    context.requestId,
  );
}
