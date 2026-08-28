import type {
  ListMetricDefinitionsRequest,
  MetricDefinitionView,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  AnalyticsDefinitionValidationError,
  listMetricDefinitions as listPersistedMetricDefinitions,
} from "../metric-definitions";
import { resolveAnalyticsAccess, type AnalyticsDeps } from "./analytics-access";

/** Lists persisted Analytics definitions only after Core has authorized the caller. */
export async function listAnalyticsMetricDefinitions(
  deps: AnalyticsDeps,
  request: ListMetricDefinitionsRequest,
): Promise<RpcResult<ReadonlyArray<MetricDefinitionView>>> {
  const access = await resolveAnalyticsAccess(deps, request);
  if (!access.ok) return access;
  try {
    return {
      ok: true,
      value: await listPersistedMetricDefinitions(deps.db, request),
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
