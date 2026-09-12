import { describe, expect, it, vi } from "vitest";
import { GoogleRoutesPreview } from "./google-routes-preview";

const input = {
  origin: { latitude: 10.3157, longitude: 123.8854 },
  orderedDestinations: [
    { latitude: 10.32, longitude: 123.9 },
    { latitude: 10.33, longitude: 123.91 },
  ],
};

const response = {
  routes: [
    {
      distanceMeters: 2_000,
      duration: "480s",
      polyline: {
        geoJsonLinestring: {
          type: "LineString",
          coordinates: [
            [123.8854, 10.3157],
            [123.9, 10.32],
            [123.91, 10.33],
          ],
        },
      },
      legs: [
        { distanceMeters: 900, duration: "210s" },
        { distanceMeters: 1_100, duration: "270s" },
      ],
    },
  ],
};

describe("Google Routes preview", () => {
  it("returns GeoJSON route geometry and ordered leg totals", async () => {
    let requestedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
      requestedInit = init;
      return Response.json(response);
    });
    const adapter = new GoogleRoutesPreview("server-key", fetchImpl);
    await expect(adapter.preview(input)).resolves.toEqual({
      geometry: response.routes[0].polyline.geoJsonLinestring,
      totalMeters: 2_000,
      totalSeconds: 480,
      legs: [
        { meters: 900, seconds: 210 },
        { meters: 1_100, seconds: 270 },
      ],
    });
    expect(requestedInit?.headers).toMatchObject({
      "X-Goog-Api-Key": "server-key",
      "X-Goog-FieldMask": expect.stringContaining("routes.polyline.geoJsonLinestring"),
    });
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({
      travelMode: "DRIVE",
      polylineEncoding: "GEO_JSON_LINESTRING",
      intermediates: [{ location: { latLng: input.orderedDestinations[0] } }],
    });
  });

  it("rejects no-route and malformed-duration responses", async () => {
    await expect(
      new GoogleRoutesPreview("server-key", async () => Response.json({ routes: [] })).preview(
        input,
      ),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    await expect(
      new GoogleRoutesPreview("server-key", async () =>
        Response.json({
          routes: [{ ...response.routes[0], duration: "not-a-duration" }],
        }),
      ).preview(input),
    ).rejects.toMatchObject({ code: "ROUTE_INVALID_RESPONSE" });
  });

  it("preserves the maximum supported manual stop order", async () => {
    let body: Record<string, unknown> | undefined;
    const destinations = Array.from({ length: 24 }, (_, index) => ({
      latitude: 10.32 + index / 1_000,
      longitude: 123.9 + index / 1_000,
    }));
    const legs = destinations.map(() => ({ distanceMeters: 100, duration: "30s" }));
    const coordinates = [input.origin, ...destinations].map(
      ({ longitude, latitude }) => [longitude, latitude] as const,
    );
    const adapter = new GoogleRoutesPreview("server-key", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        routes: [
          {
            distanceMeters: 2_400,
            duration: "720s",
            polyline: { geoJsonLinestring: { type: "LineString", coordinates } },
            legs,
          },
        ],
      });
    });
    await expect(
      adapter.preview({ origin: input.origin, orderedDestinations: destinations }),
    ).resolves.toMatchObject({ totalMeters: 2_400 });
    expect(body?.intermediates).toEqual(
      destinations.slice(0, -1).map((coordinate) => ({ location: { latLng: coordinate } })),
    );
  });

  it("rejects invalid request geometry before transport and fails closed without a key", async () => {
    let called = false;
    const adapter = new GoogleRoutesPreview("server-key", async () => {
      called = true;
      return Response.json({ routes: [] });
    });
    await expect(
      adapter.preview({
        origin: input.origin,
        orderedDestinations: [{ latitude: 91, longitude: 123.9 }],
      }),
    ).rejects.toMatchObject({ code: "ROUTE_INVALID_REQUEST" });
    expect(called).toBe(false);
    await expect(new GoogleRoutesPreview("").preview(input)).rejects.toMatchObject({
      code: "ROUTE_UNCONFIGURED",
    });
  });

  it("maps provider deadline and network failure to distinct stable errors", async () => {
    await expect(
      new GoogleRoutesPreview("server-key", async () => {
        throw new DOMException("deadline", "AbortError");
      }).preview(input),
    ).rejects.toMatchObject({ code: "ROUTE_TIMEOUT" });
    await expect(
      new GoogleRoutesPreview("server-key", async () => {
        throw new Error("network unavailable");
      }).preview(input),
    ).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });
});
