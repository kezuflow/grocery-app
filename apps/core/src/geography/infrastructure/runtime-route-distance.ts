import type { RouteDistancePort } from "../ports/route-distance";
import { GoogleRoutesDistance, RouteDistanceError } from "./google-routes-distance";

export function buildRouteDistancePort(
  environment: {
    ENVIRONMENT?: string;
    ROUTE_DISTANCE_PROVIDER?: string;
    GOOGLE_MAPS_SERVER_KEY?: string;
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
  if (environment.ROUTE_DISTANCE_PROVIDER === "google_maps" && environment.GOOGLE_MAPS_SERVER_KEY)
    return new GoogleRoutesDistance(environment.GOOGLE_MAPS_SERVER_KEY, fetchImpl);
  return {
    async routeDistance() {
      throw new RouteDistanceError("ROUTE_DISTANCE_UNCONFIGURED");
    },
  };
}
