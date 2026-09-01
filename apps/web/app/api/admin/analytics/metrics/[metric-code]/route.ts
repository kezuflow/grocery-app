import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import {
  parseDefinitionVersion,
  parseDimensions,
  parseMetricCode,
  parseScope,
  parseWindow,
} from "../../route-utils";

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ "metric-code": string }> },
) {
  const path = await params;
  const metricCode = parseMetricCode(request, path["metric-code"]);
  if (metricCode instanceof Response) return metricCode;
  const query = new URL(request.url).searchParams;
  const window = parseWindow(request, query);
  if (window instanceof Response) return window;
  const definitionVersion = parseDefinitionVersion(request, query);
  if (definitionVersion instanceof Response) return definitionVersion;
  const dimensions = parseDimensions(request, query);
  if (dimensions instanceof Response) return dimensions;
  const scope = parseScope(request, query);
  if (scope instanceof Response) return scope;
  return adminJson(
    await coreClient(env.CORE).getMetricSeries({
      requestId: webRequestId(request),
      headers: requestHeaders(request),
      metricCode,
      definitionVersion,
      window,
      dimensions,
      scope,
    }),
  );
}

export const GET = observeAdminRoute("admin.analytics.metrics.by_metric_code.get", GETHandler);
