import { describe, expect, it } from "vitest";
import { buildRouteDistancePort } from "./runtime-route-distance";

const input = {
  origin: { latitude: 10.3157, longitude: 123.8854 },
  destination: { latitude: 10.32, longitude: 123.9 },
};

describe("runtime route-distance selection", () => {
  it("allows the deterministic mock only in test", async () => {
    const port = buildRouteDistancePort({
      ENVIRONMENT: "test",
      ROUTE_DISTANCE_PROVIDER: "mock",
    });
    await expect(port.routeDistance(input)).resolves.toEqual({
      distanceMeters: 2_000,
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    });
  });

  it.each(["development", "preview", "production"])(
    "blocks the route mock in %s",
    async (environment) => {
      const port = buildRouteDistancePort({
        ENVIRONMENT: environment,
        ROUTE_DISTANCE_PROVIDER: "mock",
      });
      await expect(port.routeDistance(input)).rejects.toMatchObject({
        code: "ROUTE_DISTANCE_UNCONFIGURED",
      });
    },
  );

  it("builds Mapbox only from explicit selection plus secret", async () => {
    const port = buildRouteDistancePort(
      {
        ENVIRONMENT: "production",
        ROUTE_DISTANCE_PROVIDER: "mapbox",
        MAPBOX_ACCESS_TOKEN: "secret-token",
      },
      async () => Response.json({ code: "Ok", routes: [{ distance: 900 }] }),
    );
    await expect(port.routeDistance(input)).resolves.toMatchObject({ distanceMeters: 900 });
  });
});
