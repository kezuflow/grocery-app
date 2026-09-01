import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, parseScope } from "../analytics/route-utils";

/** Thin same-origin adapter for the Core-owned operational overview. */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const selectedScope = parseScope(request, params);
  if (selectedScope instanceof Response) return selectedScope;
  const timezone = params.get("timezone")?.trim() ?? "";
  if (!timezone) return invalid(request, "An explicit timezone is required");
  return adminJson(
    await coreClient(env.CORE).getAdminOverview({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      selectedScope,
      timezone,
    }),
  );
}

export const GET = observeAdminRoute("admin.overview.get", GETHandler);
