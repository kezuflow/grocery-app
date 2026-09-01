import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { invalid, parseDimensions, parseScope, parseWindow } from "../route-utils";

async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const window = parseWindow(request, params);
  if (window instanceof Response) return window;
  const dimensions = parseDimensions(request, params);
  if (dimensions instanceof Response) return dimensions;
  const scope = parseScope(request, params);
  if (scope instanceof Response) return scope;
  try {
    return adminJson(
      await coreClient(env.CORE).getAnalyticsOverview({
        requestId: webRequestId(request),
        headers: requestHeaders(request),
        window,
        dimensions,
        scope,
      }),
    );
  } catch (error) {
    return invalid(request, (error as Error).message || "Invalid Analytics request");
  }
}

export const GET = observeAdminRoute("admin.analytics.overview.get", GETHandler);
