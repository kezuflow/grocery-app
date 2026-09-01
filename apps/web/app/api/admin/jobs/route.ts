import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

/** Recent scheduled-job runs. Authorization happens in Core IAM. */
async function GETHandler(request: Request) {
  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  return adminJson(
    await coreClient(env.CORE).adminScheduledJobRuns({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      ...(Number.isFinite(limit) ? { limit } : {}),
    }),
  );
}

export const GET = observeAdminRoute("admin.jobs.get", GETHandler);
