import type {
  AnalyticsDimension,
  AnalyticsDimensionKey,
  AnalyticsWindow,
} from "@freshmarkets/contracts";

const DIMENSION_KEYS = new Set<AnalyticsDimensionKey>([
  "marketId",
  "locationId",
  "currency",
  "baseUnit",
  "promotionId",
  "promotionBenefitType",
  "inventoryAdjustmentReason",
]);

export function invalid(message: string): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId: crypto.randomUUID() },
    },
    { status: 400 },
  );
}

function value(params: URLSearchParams, key: string): string | undefined {
  const found = params.get(key)?.trim();
  return found || undefined;
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseWindow(params: URLSearchParams): AnalyticsWindow | Response {
  const startAt = value(params, "startAt");
  const endAt = value(params, "endAt");
  const timezone = value(params, "timezone");
  if (!startAt || !endAt || !timezone) {
    return invalid("startAt, endAt, and timezone are required");
  }
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return invalid("startAt and endAt must be valid ISO instants with startAt before endAt");
  }
  if (!validTimezone(timezone)) return invalid("timezone must be a valid IANA timezone");
  return { startAt, endAt, timezone };
}

export function parseDimensions(
  params: URLSearchParams,
): ReadonlyArray<AnalyticsDimension> | Response {
  const raw = value(params, "dimensions");
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 4)
      return invalid("dimensions must be a JSON array with at most four entries");
    const dimensions: AnalyticsDimension[] = [];
    const keys = new Set<string>();
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as { key?: unknown }).key !== "string" ||
        typeof (item as { value?: unknown }).value !== "string" ||
        !DIMENSION_KEYS.has((item as { key: string }).key as AnalyticsDimensionKey) ||
        (item as { value: string }).value.length === 0 ||
        (item as { value: string }).value.length > 200 ||
        keys.has((item as { key: string }).key)
      ) {
        return invalid("dimensions contain an unsupported, duplicate, or oversized entry");
      }
      keys.add((item as { key: string }).key);
      dimensions.push({
        key: (item as { key: AnalyticsDimensionKey }).key,
        value: (item as { value: string }).value,
      });
    }
    return dimensions;
  } catch {
    return invalid("dimensions must be valid JSON");
  }
}

export function parseScope(params: URLSearchParams) {
  const kind = value(params, "scopeKind");
  const locationId = value(params, "locationId");
  const marketId = value(params, "marketId");
  if (kind === "GLOBAL" && !locationId && !marketId) return { kind: "GLOBAL" as const };
  if (kind === "MARKET" && marketId && !locationId) {
    return { kind: "MARKET" as const, marketId };
  }
  if (kind === "LOCATION" && marketId && locationId) {
    return { kind: "LOCATION" as const, marketId, locationId };
  }
  return invalid("An explicit valid scopeKind and its required identifiers are required");
}

export function parseMetricCode(metricCode: string): string | Response {
  if (!/^[a-z][a-z0-9_]{1,99}$/.test(metricCode)) {
    return invalid("metricCode must contain lowercase letters, numbers, and underscores");
  }
  return metricCode;
}

export function parseDefinitionVersion(params: URLSearchParams): number | undefined | Response {
  const raw = value(params, "definitionVersion");
  if (!raw) return undefined;
  const version = Number(raw);
  return Number.isInteger(version) && version > 0
    ? version
    : invalid("definitionVersion must be a positive integer");
}
