import { describe, expect, it } from "vitest";
import { MapboxRouteDistance } from "./mapbox-route-distance";

describe("Mapbox route-distance adapter", () => {
  it("calls mapbox/driving with the exact route options and returns integer meters", async () => {
    let requested: Request | undefined;
    const adapter = new MapboxRouteDistance("test-token", async (input, init) => {
      requested = new Request(input, init);
      return Response.json({ code: "Ok", routes: [{ distance: 1_234.2 }] });
    });

    const result = await adapter.routeDistance({
      origin: { latitude: 10.3157, longitude: 123.8854 },
      destination: { latitude: 10.32, longitude: 123.9 },
    });

    expect(requested?.method).toBe("GET");
    expect(requested ? new URL(requested.url).pathname : "").toBe(
      "/directions/v5/mapbox/driving/123.8854,10.3157;123.9,10.32",
    );
    expect(requested ? Object.fromEntries(new URL(requested.url).searchParams) : {}).toEqual({
      access_token: "test-token",
      alternatives: "false",
      overview: "false",
      steps: "false",
    });
    expect(result).toEqual({
      distanceMeters: 1_235,
      calculation: { method: "ROAD_ROUTE", profile: "DRIVING" },
    });
  });

  it.each([
    [new Response("upstream", { status: 503 }), "ROUTE_DISTANCE_UNAVAILABLE"],
    [Response.json({ code: "NoRoute", routes: [] }), "ROUTE_NOT_FOUND"],
    [Response.json({ code: "Ok", routes: [] }), "ROUTE_DISTANCE_INVALID_RESPONSE"],
    [Response.json({ code: "Ok", routes: [{ distance: -1 }] }), "ROUTE_DISTANCE_INVALID_RESPONSE"],
  ])("maps provider failures to stable application errors", async (response, code) => {
    const adapter = new MapboxRouteDistance("test-token", async () => response);
    await expect(
      adapter.routeDistance({
        origin: { latitude: 10.3157, longitude: 123.8854 },
        destination: { latitude: 10.32, longitude: 123.9 },
      }),
    ).rejects.toMatchObject({ code });
  });

  it("fails closed when the access token is absent", async () => {
    const adapter = new MapboxRouteDistance("", async () => {
      throw new Error("fetch must not run");
    });
    await expect(
      adapter.routeDistance({
        origin: { latitude: 10.3157, longitude: 123.8854 },
        destination: { latitude: 10.32, longitude: 123.9 },
      }),
    ).rejects.toMatchObject({ code: "ROUTE_DISTANCE_UNCONFIGURED" });
  });
});
