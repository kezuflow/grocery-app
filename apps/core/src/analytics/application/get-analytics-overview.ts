import type {
  AnalyticsOverviewRequest,
  AnalyticsOverviewView,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  AnalyticsDefinitionValidationError,
  listMetricDefinitions,
  parseAnalyticsDimensions,
  parseAnalyticsWindow,
  resolveMetricDefinition,
} from "../metric-definitions";
import { resolveAnalyticsAccess, type AnalyticsDeps } from "./analytics-access";
import { executeMetricQuery } from "./metric-queries";

/** Composes Overview from the same persisted definitions and named query dispatch as series reads. */
export async function getAnalyticsOverview(
  deps: AnalyticsDeps,
  request: AnalyticsOverviewRequest,
): Promise<RpcResult<AnalyticsOverviewView>> {
  const access = await resolveAnalyticsAccess(deps, request, request.scope);
  if (!access.ok) return access;
  try {
    const window = parseAnalyticsWindow(request.window);
    const dimensions = parseAnalyticsDimensions(request.dimensions ?? []);
    const definitions = await listMetricDefinitions(deps.db, {});
    const metrics = [] as AnalyticsOverviewView["metrics"] extends ReadonlyArray<infer Item>
      ? Item[]
      : never[];
    const definitionReferences = [] as AnalyticsOverviewView["definitions"] extends ReadonlyArray<
      infer Item
    >
      ? Item[]
      : never[];
    const freshWatermarks: number[] = [];
    for (const definition of definitions) {
      definitionReferences.push({
        metricCode: definition.code,
        definitionVersion: definition.version,
      });
      if (dimensions.some((dimension) => !definition.dimensions.includes(dimension.key))) continue;
      const resolved = await resolveMetricDefinition(deps.db, definition.code, definition.version);
      if (resolved.queryKey === null) {
        metrics.push({
          metricCode: definition.code,
          definitionVersion: definition.version,
          availability: "UNAVAILABLE",
          value: null,
          unavailableReason: definition.unavailableReason,
          dimensions,
        });
        continue;
      }
      const result = await executeMetricQuery({
        database: deps.db,
        queryKey: resolved.queryKey,
        definition,
        window,
        scope: access.value.scope,
        dimensions,
        computedAt: access.value.now,
      });
      const watermark = result.freshness.sourceWatermark;
      if (watermark) freshWatermarks.push(Date.parse(watermark));
      metrics.push({
        metricCode: definition.code,
        definitionVersion: definition.version,
        availability: result.availability,
        value: result.availability === "AVAILABLE" ? (result.points[0]?.value ?? null) : null,
        unavailableReason: result.unavailableReason,
        dimensions,
      });
    }
    return {
      ok: true,
      value: {
        window,
        scope: access.value.scope,
        definitions: definitionReferences,
        freshness: {
          sourceWatermark: freshWatermarks.length
            ? new Date(Math.max(...freshWatermarks)).toISOString()
            : null,
          computedAt: new Date(access.value.now).toISOString(),
        },
        metrics,
      },
      requestId: request.requestId,
    };
  } catch (error) {
    if (error instanceof AnalyticsDefinitionValidationError)
      return {
        ok: false,
        error: { code: error.code, message: error.message, requestId: request.requestId },
      };
    throw error;
  }
}
