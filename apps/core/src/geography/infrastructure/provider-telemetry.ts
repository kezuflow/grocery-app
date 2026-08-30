import { log } from "../../observability";

export type ProviderOperation =
  | "MAPBOX_GEOCODER_SEARCH"
  | "MAPBOX_GEOCODER_REVERSE_PERMANENT"
  | "MAPBOX_ROUTE_DISTANCE"
  | "MAPBOX_ROUTE_PREVIEW";

export type ProviderErrorCode =
  | "GEOCODER_UNCONFIGURED"
  | "GEOCODER_INVALID_REQUEST"
  | "GEOCODER_UNAUTHORIZED"
  | "GEOCODER_RATE_LIMITED"
  | "GEOCODER_TIMEOUT"
  | "GEOCODER_UNAVAILABLE"
  | "GEOCODER_INVALID_RESPONSE"
  | "GEOCODER_NO_RESULTS"
  | "ROUTE_DISTANCE_UNCONFIGURED"
  | "ROUTE_DISTANCE_UNAVAILABLE"
  | "ROUTE_DISTANCE_TIMEOUT"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_DISTANCE_INVALID_RESPONSE"
  | "ROUTE_UNCONFIGURED"
  | "ROUTE_INVALID_REQUEST"
  | "ROUTE_TIMEOUT"
  | "ROUTE_UNAVAILABLE"
  | "ROUTE_INVALID_RESPONSE"
  | "PROVIDER_OPERATION_FAILED";

export type ProviderTelemetryEvent = Readonly<{
  operation: ProviderOperation;
  durationMilliseconds: number;
  result: "SUCCESS" | "FAILURE";
  errorCode?: ProviderErrorCode;
}>;

export type ProviderTelemetryDependencies = Readonly<{
  sink: (event: ProviderTelemetryEvent) => void;
  clock: () => number;
}>;

const MAXIMUM_RECORDED_DURATION_MILLISECONDS = 60_000;
const STABLE_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  "GEOCODER_UNCONFIGURED",
  "GEOCODER_INVALID_REQUEST",
  "GEOCODER_UNAUTHORIZED",
  "GEOCODER_RATE_LIMITED",
  "GEOCODER_TIMEOUT",
  "GEOCODER_UNAVAILABLE",
  "GEOCODER_INVALID_RESPONSE",
  "GEOCODER_NO_RESULTS",
  "ROUTE_DISTANCE_UNCONFIGURED",
  "ROUTE_DISTANCE_UNAVAILABLE",
  "ROUTE_DISTANCE_TIMEOUT",
  "ROUTE_NOT_FOUND",
  "ROUTE_DISTANCE_INVALID_RESPONSE",
  "ROUTE_UNCONFIGURED",
  "ROUTE_INVALID_REQUEST",
  "ROUTE_TIMEOUT",
  "ROUTE_UNAVAILABLE",
  "ROUTE_INVALID_RESPONSE",
]);

export const defaultProviderTelemetry: ProviderTelemetryDependencies = {
  clock: () => performance.now(),
  sink: (event) => log(event.result === "SUCCESS" ? "info" : "warn", "provider_operation", event),
};

export async function observeProviderOperation<T>(
  operation: ProviderOperation,
  telemetry: ProviderTelemetryDependencies,
  execute: () => Promise<T>,
): Promise<T> {
  const startedAt = safeClock(telemetry.clock);
  try {
    const value = await execute();
    safelyEmit(telemetry.sink, {
      operation,
      durationMilliseconds: durationMilliseconds(startedAt, telemetry.clock),
      result: "SUCCESS",
    });
    return value;
  } catch (error) {
    safelyEmit(telemetry.sink, {
      operation,
      durationMilliseconds: durationMilliseconds(startedAt, telemetry.clock),
      result: "FAILURE",
      errorCode: stableErrorCode(error),
    });
    throw error;
  }
}

function durationMilliseconds(startedAt: number, clock: () => number): number {
  const elapsed = safeClock(clock) - startedAt;
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(MAXIMUM_RECORDED_DURATION_MILLISECONDS, Math.max(0, Math.round(elapsed)));
}

function safeClock(clock: () => number): number {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function stableErrorCode(error: unknown): ProviderErrorCode {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    STABLE_ERROR_CODES.has(error.code as ProviderErrorCode)
  )
    return error.code as ProviderErrorCode;
  return "PROVIDER_OPERATION_FAILED";
}

function safelyEmit(
  sink: ProviderTelemetryDependencies["sink"],
  event: ProviderTelemetryEvent,
): void {
  try {
    sink(event);
  } catch {
    // Diagnostic telemetry must never alter provider or domain outcomes.
  }
}
