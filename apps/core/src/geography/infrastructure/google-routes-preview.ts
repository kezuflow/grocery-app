import {
  RoutePreviewError,
  type RoutePreviewPort,
  type RoutePreviewResult,
} from "../ports/route-preview";
import {
  defaultProviderTelemetry,
  observeProviderOperation,
  type ProviderTelemetryDependencies,
} from "./provider-telemetry";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const MINIMUM_COORDINATES = 2;
const MAXIMUM_COORDINATES = 25;
const FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.geoJsonLinestring",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
].join(",");

export { RoutePreviewError } from "../ports/route-preview";

export class GoogleRoutesPreview implements RoutePreviewPort {
  constructor(
    private readonly serverApiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    private readonly telemetry: ProviderTelemetryDependencies = defaultProviderTelemetry,
  ) {}

  async preview(input: Parameters<RoutePreviewPort["preview"]>[0]): Promise<RoutePreviewResult> {
    return observeProviderOperation("GOOGLE_MAPS_ROUTE_PREVIEW", this.telemetry, async () => {
      if (!this.serverApiKey) throw new RoutePreviewError("ROUTE_UNCONFIGURED");
      const coordinates = [input.origin, ...input.orderedDestinations];
      if (
        coordinates.length < MINIMUM_COORDINATES ||
        coordinates.length > MAXIMUM_COORDINATES ||
        !coordinates.every(isValidCoordinate)
      )
        throw new RoutePreviewError("ROUTE_INVALID_REQUEST");

      const lastIndex = coordinates.length - 1;
      const payload = await this.request({
        origin: waypoint(coordinates[0]!),
        destination: waypoint(coordinates[lastIndex]!),
        intermediates: coordinates.slice(1, lastIndex).map(waypoint),
        travelMode: "DRIVE",
        computeAlternativeRoutes: false,
        polylineEncoding: "GEO_JSON_LINESTRING",
        polylineQuality: "OVERVIEW",
      });
      if (!Array.isArray(payload.routes)) throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      if (payload.routes.length === 0) throw new RoutePreviewError("ROUTE_NOT_FOUND");
      if (payload.routes.length !== 1 || !isRecord(payload.routes[0]))
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      const route = payload.routes[0];
      const geometry = isRecord(route.polyline) ? route.polyline.geoJsonLinestring : undefined;
      if (
        !isRecord(geometry) ||
        geometry.type !== "LineString" ||
        !isValidLineStringCoordinates(geometry.coordinates) ||
        !isNonnegativeSafeInteger(route.distanceMeters) ||
        parseDuration(route.duration) === null ||
        !Array.isArray(route.legs) ||
        route.legs.length !== input.orderedDestinations.length
      )
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      const legs = route.legs.map((leg) => {
        if (!isRecord(leg) || !isNonnegativeSafeInteger(leg.distanceMeters))
          throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
        const seconds = parseDuration(leg.duration);
        if (seconds === null) throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
        return { meters: leg.distanceMeters, seconds };
      });
      return {
        geometry: { type: "LineString", coordinates: geometry.coordinates },
        totalMeters: route.distanceMeters,
        totalSeconds: parseDuration(route.duration)!,
        legs,
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
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      });
    } catch (error) {
      if (isAbortOrTimeoutError(error)) throw new RoutePreviewError("ROUTE_TIMEOUT");
      throw new RoutePreviewError("ROUTE_UNAVAILABLE");
    }
    if (!response.ok) throw new RoutePreviewError("ROUTE_UNAVAILABLE");
    try {
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error("invalid");
      return payload;
    } catch {
      throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
    }
  }
}

function waypoint(coordinate: { latitude: number; longitude: number }) {
  return { location: { latLng: coordinate } };
}

function parseDuration(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?s$/.test(value)) return null;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidCoordinate(value: unknown): value is { latitude: number; longitude: number } {
  return (
    isRecord(value) &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function isValidLineStringCoordinates(
  value: unknown,
): value is ReadonlyArray<readonly [number, number]> {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (position) =>
        Array.isArray(position) &&
        position.length === 2 &&
        isValidCoordinate({ longitude: position[0], latitude: position[1] }),
    )
  );
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
