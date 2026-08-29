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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ "metric-code": string }> },
) {
  const path = await params;
  const metricCode = parseMetricCode(path["metric-code"]);
  if (metricCode instanceof Response) return metricCode;
  const query = new URL(request.url).searchParams;
  const window = parseWindow(query);
  if (window instanceof Response) return window;
  const definitionVersion = parseDefinitionVersion(query);
  if (definitionVersion instanceof Response) return definitionVersion;
  const dimensions = parseDimensions(query);
  if (dimensions instanceof Response) return dimensions;
  const scope = parseScope(query);
  if (scope instanceof Response) return scope;
  return Response.json(
    await coreClient(env.CORE).getMetricSeries({
      requestId: crypto.randomUUID(),
      headers: requestHeaders(request),
      metricCode,
      definitionVersion,
      window,
      dimensions,
      scope,
    }),
  );
}
