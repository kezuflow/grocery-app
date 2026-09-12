import type { RouteDistancePort, RouteDistanceResult } from "../ports/route-distance";
import {
  defaultProviderTelemetry,
  observeProviderOperation,
  type ProviderTelemetryDependencies,
} from "./provider-telemetry";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

export type RouteDistanceErrorCode =
  | "ROUTE_DISTANCE_UNCONFIGURED"
  | "ROUTE_DISTANCE_UNAVAILABLE"
  | "ROUTE_DISTANCE_TIMEOUT"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_DISTANCE_INVALID_RESPONSE";

export class RouteDistanceError extends Error {
  constructor(readonly code: RouteDistanceErrorCode) {
    super(code);
    this.name = "RouteDistanceError";
  }
}

export class GoogleRoutesDistance implements RouteDistancePort {
  constructor(
    private readonly serverApiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly telemetry: ProviderTelemetryDependencies = defaultProviderTelemetry,
  ) {}

  async routeDistance(
    input: Parameters<RouteDistancePort["routeDistance"]>[0],
  ): Promise<RouteDistanceResult> {
    return observeProviderOperation("GOOGLE_MAPS_ROUTE_DISTANCE", this.telemetry, async () => {
      if (!this.serverApiKey) throw new RouteDistanceError("ROUTE_DISTANCE_UNCONFIGURED");
      validateCoordinate(input.origin);
      validateCoordinate(input.destination);
      const payload = await this.request({
        origin: waypoint(input.origin),
        destination: waypoint(input.destination),
        travelMode: "DRIVE",
        computeAlternativeRoutes: false,
      });
      if (!Array.isArray(payload.routes))
        throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
      if (payload.routes.length === 0) throw new RouteDistanceError("ROUTE_NOT_FOUND");
      const distance = isRecord(payload.routes[0]) ? payload.routes[0].distanceMeters : undefined;
      if (!isNonnegativeSafeInteger(distance))
        throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
      return {
        distanceMeters: distance,
        calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
      };
    });
  }

  private async request(body: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.serverApiKey,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (isAbortOrTimeoutError(error)) throw new RouteDistanceError("ROUTE_DISTANCE_TIMEOUT");
      throw new RouteDistanceError("ROUTE_DISTANCE_UNAVAILABLE");
    }
    if (!response.ok) throw new RouteDistanceError("ROUTE_DISTANCE_UNAVAILABLE");
    try {
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error("invalid");
      return payload;
    } catch {
      throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
    }
  }
}

function waypoint(coordinate: { latitude: number; longitude: number }) {
  return { location: { latLng: coordinate } };
}

function validateCoordinate(coordinate: { latitude: number; longitude: number }): void {
  if (
    !Number.isFinite(coordinate.latitude) ||
    !Number.isFinite(coordinate.longitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90 ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180
  )
    throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAbortOrTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")) ||
    (isRecord(error) && (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}
