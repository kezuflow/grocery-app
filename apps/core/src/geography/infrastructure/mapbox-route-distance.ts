import type { RouteDistancePort, RouteDistanceResult } from "../ports/route-distance";

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

export class MapboxRouteDistance implements RouteDistancePort {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async routeDistance(
    input: Parameters<RouteDistancePort["routeDistance"]>[0],
  ): Promise<RouteDistanceResult> {
    if (!this.accessToken) throw new RouteDistanceError("ROUTE_DISTANCE_UNCONFIGURED");
    validateCoordinates(input.origin.latitude, input.origin.longitude);
    validateCoordinates(input.destination.latitude, input.destination.longitude);
    const coordinates = `${input.origin.longitude},${input.origin.latitude};${input.destination.longitude},${input.destination.latitude}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("overview", "false");
    url.searchParams.set("steps", "false");
    url.searchParams.set("access_token", this.accessToken);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new RouteDistanceError("ROUTE_DISTANCE_TIMEOUT");
      throw new RouteDistanceError("ROUTE_DISTANCE_UNAVAILABLE");
    }
    if (!response.ok) throw new RouteDistanceError("ROUTE_DISTANCE_UNAVAILABLE");

    let payload: { code?: unknown; routes?: Array<{ distance?: unknown }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
    }
    if (payload.code === "NoRoute") throw new RouteDistanceError("ROUTE_NOT_FOUND");
    const distance = payload.routes?.[0]?.distance;
    if (
      payload.code !== "Ok" ||
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      !Number.isSafeInteger(Math.ceil(distance))
    )
      throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
    return {
      distanceMeters: Math.ceil(distance),
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    };
  }
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    throw new RouteDistanceError("ROUTE_DISTANCE_INVALID_RESPONSE");
}
