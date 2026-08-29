import type { MetricSeriesRequest, MetricSeriesView, RpcResult } from "@freshmarkets/contracts";
import {
  AnalyticsDefinitionValidationError,
  parseAnalyticsDimensions,
  parseAnalyticsWindow,
  resolveMetricDefinition,
} from "../metric-definitions";
import { resolveAnalyticsAccess, type AnalyticsDeps } from "./analytics-access";
import { executeMetricQuery } from "./metric-queries";

function validationFailure(requestId: string, error: AnalyticsDefinitionValidationError) {
  return {
    ok: false as const,
    error: { code: error.code as "VALIDATION_FAILED", message: error.message, requestId },
  };
}

/** Returns one definition-version-pinned metric series; never exposes source rows. */
export async function getMetricSeries(
  deps: AnalyticsDeps,
  request: MetricSeriesRequest,
): Promise<RpcResult<MetricSeriesView>> {
  const access = await resolveAnalyticsAccess(deps, request, request.scope);
  if (!access.ok) return access;
  try {
    const window = parseAnalyticsWindow(request.window);
    const dimensions = parseAnalyticsDimensions(request.dimensions ?? []);
    const resolved = await resolveMetricDefinition(
      deps.db,
      request.metricCode,
      request.definitionVersion,
    );
    if (dimensions.some((dimension) => !resolved.definition.dimensions.includes(dimension.key))) {
      throw new AnalyticsDefinitionValidationError(
        "Analytics dimensions are not valid for this metric",
      );
    }
    if (resolved.queryKey === null) {
      return {
        ok: true,
        value: {
          metricCode: resolved.definition.code,
          definitionVersion: resolved.definition.version,
          window,
          dimensions,
          availability: "UNAVAILABLE",
          unavailableReason: resolved.definition.unavailableReason,
          freshness: {
            sourceWatermark: null,
            computedAt: new Date(access.value.now).toISOString(),
          },
          points: [],
        },
        requestId: request.requestId,
      };
    }
    const result = await executeMetricQuery({
      database: deps.db,
      queryKey: resolved.queryKey,
      definition: resolved.definition,
      window,
      scope: access.value.scope,
      dimensions,
      computedAt: access.value.now,
    });
    return {
      ok: true,
      value: {
        metricCode: resolved.definition.code,
        definitionVersion: resolved.definition.version,
        window,
        dimensions: result.dimensions.length > 0 ? result.dimensions : dimensions,
        availability: result.availability,
        unavailableReason: result.unavailableReason,
        freshness: result.freshness,
        points: result.points,
      },
      requestId: request.requestId,
    };
  } catch (error) {
    if (error instanceof AnalyticsDefinitionValidationError)
      return validationFailure(request.requestId, error);
    throw error;
  }
}
