import { env } from "cloudflare:workers";
import { scheduledWeekQuerySchema } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
export const GET = observeAdminRoute("admin.procurement.week.get", async (request: Request) => {
  const parsed = scheduledWeekQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const requestId = webRequestId(request);
  if (!parsed.success)
    return adminJson(
      {
        ok: false as const,
        error: {
          code: "VALIDATION_FAILED" as const,
          message: "Select a location and delivery week",
          requestId,
        },
      },
      { status: 400 },
    );
  return adminJson(
    await coreClient(env.CORE).getAdminScheduledWeek({
      ...parsed.data,
      headers: requestHeaders(request),
      requestId,
    }),
  );
});
