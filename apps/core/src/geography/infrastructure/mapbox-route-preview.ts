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

const MAPBOX_DIRECTIONS_BASE_URL = "https://api.mapbox.com/directions/v5/mapbox/driving";
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const MINIMUM_COORDINATES = 2;
const MAXIMUM_COORDINATES = 25;

export { RoutePreviewError } from "../ports/route-preview";

export class MapboxRoutePreview implements RoutePreviewPort {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    private readonly telemetry: ProviderTelemetryDependencies = defaultProviderTelemetry,
  ) {}

  async preview(input: Parameters<RoutePreviewPort["preview"]>[0]): Promise<RoutePreviewResult> {
    return observeProviderOperation("MAPBOX_ROUTE_PREVIEW", this.telemetry, async () => {
      if (!this.accessToken) throw new RoutePreviewError("ROUTE_UNCONFIGURED");
      const coordinates = [input.origin, ...input.orderedDestinations];
      if (
        coordinates.length < MINIMUM_COORDINATES ||
        coordinates.length > MAXIMUM_COORDINATES ||
        !coordinates.every(isValidCoordinate)
      ) {
        throw new RoutePreviewError("ROUTE_INVALID_REQUEST");
      }

      const encodedCoordinates = coordinates
        .map(({ latitude, longitude }) => `${longitude},${latitude}`)
        .join(";");
      const url = new URL(`${MAPBOX_DIRECTIONS_BASE_URL}/${encodedCoordinates}`);
      url.searchParams.set("alternatives", "false");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");
      url.searchParams.set("steps", "false");
      url.searchParams.set("access_token", this.accessToken);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          signal: AbortSignal.timeout(this.timeoutMilliseconds),
        });
      } catch (error) {
        if (isAbortOrTimeoutError(error)) throw new RoutePreviewError("ROUTE_TIMEOUT");
        throw new RoutePreviewError("ROUTE_UNAVAILABLE");
      }
      if (!response.ok) throw new RoutePreviewError("ROUTE_UNAVAILABLE");

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      }
      if (isRecord(payload) && (payload.code === "NoRoute" || payload.code === "NoSegment"))
        throw new RoutePreviewError("ROUTE_NOT_FOUND");
      if (!isRecord(payload) || payload.code !== "Ok" || !Array.isArray(payload.routes))
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      if (payload.routes.length !== 1 || !isRecord(payload.routes[0]))
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");

      const route = payload.routes[0];
      if (
        !isRecord(route.geometry) ||
        route.geometry.type !== "LineString" ||
        !isValidLineStringCoordinates(route.geometry.coordinates) ||
        !isNonnegativeFinite(route.distance) ||
        !isNonnegativeFinite(route.duration) ||
        !Array.isArray(route.legs) ||
        route.legs.length !== input.orderedDestinations.length
      ) {
        throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
      }
      const legs = route.legs.map((leg) => {
        if (
          !isRecord(leg) ||
          !isNonnegativeFinite(leg.distance) ||
          !isNonnegativeFinite(leg.duration)
        ) {
          throw new RoutePreviewError("ROUTE_INVALID_RESPONSE");
        }
        return { meters: leg.distance, seconds: leg.duration };
      });

      return {
        geometry: {
          type: "LineString",
          coordinates: route.geometry.coordinates,
        },
        totalMeters: route.distance,
        totalSeconds: route.duration,
        legs,
      };
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidCoordinate(coordinate: unknown): coordinate is {
  latitude: number;
  longitude: number;
} {
  return (
    isRecord(coordinate) &&
    typeof coordinate.latitude === "number" &&
    typeof coordinate.longitude === "number" &&
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
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
        typeof position[0] === "number" &&
        typeof position[1] === "number" &&
        isValidCoordinate({ longitude: position[0], latitude: position[1] }),
    )
  );
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isAbortOrTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")) ||
    (isRecord(error) && (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}
