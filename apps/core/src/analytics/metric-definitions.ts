import type {
  AnalyticsDimension,
  AnalyticsMetricCategory,
  AnalyticsWindow,
  MetricDefinitionStatus,
  MetricDefinitionView,
} from "@freshmarkets/contracts";
import { analyticsDimensionKeys } from "@freshmarkets/contracts";
import { metricCatalog, type AnalyticsQueryKey } from "./metric-catalog";

export class AnalyticsDefinitionValidationError extends Error {
  readonly code = "VALIDATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "AnalyticsDefinitionValidationError";
  }
}

export type ResolvedMetricDefinition = {
  definition: MetricDefinitionView;
  queryKey: AnalyticsQueryKey | null;
};

const MAX_ANALYTICS_DIMENSIONS = 4;
const analyticsDimensionKeySet = new Set<string>(analyticsDimensionKeys);

function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Validates the required half-open reporting window before Analytics reads. */
export function parseAnalyticsWindow(input: unknown): AnalyticsWindow {
  const candidate = input as Partial<AnalyticsWindow>;
  if (
    !isIsoInstant(candidate.startAt) ||
    !isIsoInstant(candidate.endAt) ||
    !isIanaTimezone(candidate.timezone) ||
    Date.parse(candidate.startAt) >= Date.parse(candidate.endAt)
  ) {
    throw new AnalyticsDefinitionValidationError(
      "Analytics window requires ordered instants and an explicit IANA timezone",
    );
  }
  return { startAt: candidate.startAt, endAt: candidate.endAt, timezone: candidate.timezone };
}

/** Validates the bounded, closed dimension vocabulary before source reads. */
export function parseAnalyticsDimensions(input: unknown): ReadonlyArray<AnalyticsDimension> {
  if (!Array.isArray(input) || input.length > MAX_ANALYTICS_DIMENSIONS) {
    throw new AnalyticsDefinitionValidationError("Analytics dimensions must be a bounded array");
  }
  const dimensions: AnalyticsDimension[] = [];
  const keys = new Set<string>();
  for (const candidate of input) {
    const dimension = candidate as Partial<AnalyticsDimension>;
    const key = dimension.key;
    const value = dimension.value;
    if (
      typeof key !== "string" ||
      !analyticsDimensionKeySet.has(key) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 200 ||
      keys.has(key)
    ) {
      throw new AnalyticsDefinitionValidationError(
        "Analytics dimensions must use unique closed keys",
      );
    }
    keys.add(key);
    dimensions.push({ key: key as AnalyticsDimension["key"], value });
  }
  return dimensions;
}

/** Lists only the closed, application-owned definition metadata. */
export function listMetricDefinitions(
  filters: {
    category?: AnalyticsMetricCategory;
    status?: MetricDefinitionStatus;
  } = {},
): ReadonlyArray<MetricDefinitionView> {
  return metricCatalog
    .filter(
      (entry) => filters.category === undefined || entry.definition.category === filters.category,
    )
    .filter((entry) => filters.status === undefined || entry.status === filters.status)
    .map((entry) => entry.definition);
}

/**
 * Resolves a known version to its named query function key. This is the only
 * definition lookup that execution paths may use; it accepts neither arbitrary
 * formulas nor data-source identifiers.
 */
export function resolveMetricDefinition(
  metricCode: string,
  definitionVersion?: number,
): ResolvedMetricDefinition {
  const entry = metricCatalog.find((candidate) => candidate.definition.code === metricCode);
  if (
    !entry ||
    (definitionVersion !== undefined && definitionVersion !== entry.definition.version)
  ) {
    throw new AnalyticsDefinitionValidationError("Unknown metric definition or version");
  }
  return { definition: entry.definition, queryKey: entry.queryKey };
}
