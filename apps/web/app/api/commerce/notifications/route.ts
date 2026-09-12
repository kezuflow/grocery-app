import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { jsonWithRequestId, webRequestContext } from "@/lib/http/request-context";

export async function GET(request: Request) {
  const context = webRequestContext(request);
  const result = await coreClient(env.CORE).listCustomerNotifications({
    requestId: context.requestId,
    headers: context.coreHeaders,
  });
  return jsonWithRequestId(result, context.requestId, {
    status: result.ok
      ? 200
      : result.error.code === "UNAUTHENTICATED"
        ? 401
        : result.error.code === "FORBIDDEN"
          ? 403
          : 500,
    headers: { "Cache-Control": "private, no-store" },
  });
}
