import type { RouteDistancePort } from "../ports/route-distance";
import { MapboxRouteDistance, RouteDistanceError } from "./mapbox-route-distance";

export function buildRouteDistancePort(
  environment: {
    ENVIRONMENT?: string;
    ROUTE_DISTANCE_PROVIDER?: string;
    MAPBOX_ACCESS_TOKEN?: string;
  },
  fetchImpl: typeof fetch = fetch,
): RouteDistancePort {
  if (environment.ROUTE_DISTANCE_PROVIDER === "mock" && environment.ENVIRONMENT === "test")
    return {
      async routeDistance() {
        return {
          distanceMeters: 2_000,
          calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
        };
      },
    };
  if (environment.ROUTE_DISTANCE_PROVIDER === "mapbox" && environment.MAPBOX_ACCESS_TOKEN)
    return new MapboxRouteDistance(environment.MAPBOX_ACCESS_TOKEN, fetchImpl);
  return {
    async routeDistance() {
      throw new RouteDistanceError("ROUTE_DISTANCE_UNCONFIGURED");
    },
  };
}
