import { Temporal } from "temporal-polyfill";
import {
  analyticsDimensionKeys,
  analyticsMetricCategories,
  metricDefinitionStatuses,
  type AnalyticsDimension,
  type AnalyticsDimensionKey,
  type AnalyticsMetricCategory,
  type AnalyticsWindow,
  type MetricDefinitionStatus,
  type MetricDefinitionView,
} from "@freshmarkets/contracts";
import { isMetricCode, metricQueryKeyByCode, type AnalyticsQueryKey } from "./metric-catalog";

export class AnalyticsDefinitionValidationError extends Error {
  readonly code = "VALIDATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "AnalyticsDefinitionValidationError";
  }
}

type MetricDefinitionStatement = {
  bind(...values: unknown[]): {
    all<T>(): Promise<{ results?: T[] }>;
  };
};

/** Minimal internal D1 read surface; it is never exposed through contracts. */
export type MetricDefinitionDatabase = {
  prepare(query: string): MetricDefinitionStatement;
};

type MetricDefinitionRow = {
  code: string;
  version: number;
  displayName: string;
  category: string;
  formulaJson: string;
  dimensionsJson: string;
  status: string;
  unavailableReason: string | null;
  approvedAt: number | null;
};

export type ResolvedMetricDefinition = {
  definition: MetricDefinitionView;
  queryKey: AnalyticsQueryKey | null;
};

const MAX_ANALYTICS_DIMENSIONS = 4;
const analyticsDimensionKeySet = new Set<string>(analyticsDimensionKeys);
const analyticsMetricCategorySet = new Set<string>(analyticsMetricCategories);
const metricDefinitionStatusSet = new Set<string>(metricDefinitionStatuses);

function isIsoInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return false;
  }
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
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
    !isIanaTimezone(candidate.timezone)
  ) {
    throw new AnalyticsDefinitionValidationError(
      "Analytics window requires ordered instants and an explicit IANA timezone",
    );
  }
  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(candidate.startAt),
      Temporal.Instant.from(candidate.endAt),
    ) >= 0
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

function parseStoredFormulaDescription(value: string): string {
  try {
    const description = (JSON.parse(value) as { description?: unknown }).description;
    if (typeof description === "string" && description.length > 0) return description;
  } catch {
    // Handled by the common corrupt-definition failure below.
  }
  throw new AnalyticsDefinitionValidationError("Stored metric definition is invalid");
}

function parseStoredDimensions(value: string): ReadonlyArray<AnalyticsDimensionKey> {
  try {
    const dimensions = JSON.parse(value) as unknown;
    if (
      Array.isArray(dimensions) &&
      dimensions.every(
        (dimension) => typeof dimension === "string" && analyticsDimensionKeySet.has(dimension),
      )
    ) {
      return dimensions as AnalyticsDimensionKey[];
    }
  } catch {
    // Handled by the common corrupt-definition failure below.
  }
  throw new AnalyticsDefinitionValidationError("Stored metric definition is invalid");
}

function mapDefinitionRow(row: MetricDefinitionRow): MetricDefinitionView {
  if (
    !isMetricCode(row.code) ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    !analyticsMetricCategorySet.has(row.category) ||
    !metricDefinitionStatusSet.has(row.status)
  ) {
    throw new AnalyticsDefinitionValidationError("Stored metric definition is invalid");
  }
  const status = row.status as MetricDefinitionStatus;
  const queryKey = metricQueryKeyByCode[row.code];
  if (
    (queryKey === null && status !== "BLOCKED") ||
    (queryKey !== null && status === "BLOCKED") ||
    (status === "APPROVED" && row.unavailableReason !== null) ||
    (status === "BLOCKED" && (!row.unavailableReason || row.approvedAt !== null)) ||
    (status === "SUPERSEDED" && (!row.unavailableReason || row.approvedAt === null))
  ) {
    throw new AnalyticsDefinitionValidationError("Stored metric definition is invalid");
  }
  return {
    code: row.code,
    version: row.version,
    displayName: row.displayName,
    category: row.category as AnalyticsMetricCategory,
    formulaDescription: parseStoredFormulaDescription(row.formulaJson),
    availability: status === "APPROVED" ? "AVAILABLE" : "UNAVAILABLE",
    unavailableReason: row.unavailableReason,
    dimensions: parseStoredDimensions(row.dimensionsJson),
    freshness: null,
    approvedAt: row.approvedAt === null ? null : new Date(row.approvedAt).toISOString(),
  };
}

function parseDefinitionFilters(input: unknown): {
  category?: AnalyticsMetricCategory;
  status?: MetricDefinitionStatus;
} {
  const filters = (input ?? {}) as { category?: unknown; status?: unknown };
  if (filters.category !== undefined && !analyticsMetricCategorySet.has(String(filters.category))) {
    throw new AnalyticsDefinitionValidationError("Unknown Analytics metric category");
  }
  if (filters.status !== undefined && !metricDefinitionStatusSet.has(String(filters.status))) {
    throw new AnalyticsDefinitionValidationError("Unknown metric definition status");
  }
  return filters as { category?: AnalyticsMetricCategory; status?: MetricDefinitionStatus };
}

/** Lists D1-authoritative definition metadata; the code registry supplies no display fields. */
export async function listMetricDefinitions(
  database: MetricDefinitionDatabase,
  input: unknown = {},
): Promise<ReadonlyArray<MetricDefinitionView>> {
  const filters = parseDefinitionFilters(input);
  const where: string[] = [];
  const parameters: string[] = [];
  if (filters.category !== undefined) {
    where.push("category = ?");
    parameters.push(filters.category);
  }
  if (filters.status !== undefined) {
    where.push("status = ?");
    parameters.push(filters.status);
  } else {
    where.push(
      "version = (SELECT MAX(version) FROM metric_definitions versioned WHERE versioned.code = metric_definitions.code)",
    );
  }
  const rows = await database
    .prepare(
      `SELECT code, version, display_name AS displayName, category, formula_json AS formulaJson,
        dimensions_json AS dimensionsJson, status, unavailable_reason AS unavailableReason,
        approved_at AS approvedAt
       FROM metric_definitions${where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`}
       ORDER BY code ASC, version DESC`,
    )
    .bind(...parameters)
    .all<MetricDefinitionRow>();
  return (rows.results ?? []).map(mapDefinitionRow);
}

/** Resolves D1-authoritative metadata to its only permitted named query function. */
export async function resolveMetricDefinition(
  database: MetricDefinitionDatabase,
  metricCode: string,
  definitionVersion?: number,
): Promise<ResolvedMetricDefinition> {
  if (
    !isMetricCode(metricCode) ||
    (definitionVersion !== undefined &&
      (!Number.isSafeInteger(definitionVersion) || definitionVersion < 1))
  ) {
    throw new AnalyticsDefinitionValidationError("Unknown metric definition or version");
  }
  const where = definitionVersion === undefined ? "code = ?" : "code = ? AND version = ?";
  const parameters =
    definitionVersion === undefined ? [metricCode] : [metricCode, definitionVersion];
  const rows = await database
    .prepare(
      `SELECT code, version, display_name AS displayName, category, formula_json AS formulaJson,
        dimensions_json AS dimensionsJson, status, unavailable_reason AS unavailableReason,
        approved_at AS approvedAt
       FROM metric_definitions WHERE ${where} ORDER BY version DESC`,
    )
    .bind(...parameters)
    .all<MetricDefinitionRow>();
  const row = rows.results?.[0];
  if (!row) {
    throw new AnalyticsDefinitionValidationError("Unknown metric definition or version");
  }
  const definition = mapDefinitionRow(row);
  return {
    definition,
    queryKey: definition.availability === "AVAILABLE" ? metricQueryKeyByCode[metricCode] : null,
  };
}
