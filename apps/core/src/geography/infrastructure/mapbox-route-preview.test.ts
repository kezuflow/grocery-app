import { describe, expect, it, vi } from "vitest";
import { MapboxRoutePreview, RoutePreviewError } from "./mapbox-route-preview";

const origin = { latitude: 10.3157, longitude: 123.8854 };
const firstDestination = { latitude: 10.32, longitude: 123.9 };
const secondDestination = { latitude: 10.28, longitude: 123.84 };

function successfulResponse() {
  return Response.json({
    code: "Ok",
    routes: [
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [123.8854, 10.3157],
            [123.9, 10.32],
            [123.84, 10.28],
          ],
        },
        distance: 2_500.5,
        duration: 600.25,
        legs: [
          { distance: 1_000.25, duration: 240.5 },
          { distance: 1_500.25, duration: 359.75 },
        ],
      },
    ],
  });
}

describe("Mapbox route-preview adapter", () => {
  it("requests mapbox/driving in exact submitted order without optimization parameters", async () => {
    let requested: Request | undefined;
    const adapter = new MapboxRoutePreview("test-token", async (input, init) => {
      requested = new Request(input, init);
      return successfulResponse();
    });

    const result = await adapter.preview({
      origin,
      orderedDestinations: [firstDestination, secondDestination],
    });

    const url = requested ? new URL(requested.url) : undefined;
    expect(requested?.method).toBe("GET");
    expect(url?.pathname).toBe(
      "/directions/v5/mapbox/driving/123.8854,10.3157;123.9,10.32;123.84,10.28",
    );
    expect(url ? Object.fromEntries(url.searchParams) : {}).toEqual({
      access_token: "test-token",
      alternatives: "false",
      geometries: "geojson",
      overview: "full",
      steps: "false",
    });
    for (const parameter of [
      "roundtrip",
      "source",
      "destination",
      "waypoints",
      "optimize",
      "optimization",
    ]) {
      expect(url?.searchParams.has(parameter)).toBe(false);
    }
    expect(result).toEqual({
      geometry: {
        type: "LineString",
        coordinates: [
          [123.8854, 10.3157],
          [123.9, 10.32],
          [123.84, 10.28],
        ],
      },
      totalMeters: 2_500.5,
      totalSeconds: 600.25,
      legs: [
        { meters: 1_000.25, seconds: 240.5 },
        { meters: 1_500.25, seconds: 359.75 },
      ],
    });
  });

  it("accepts the maximum 25 total coordinates without changing manual order", async () => {
    let pathname = "";
    const destinations = Array.from({ length: 24 }, (_, index) => ({
      latitude: 10 + index / 100,
      longitude: 123 + index / 100,
    }));
    const adapter = new MapboxRoutePreview("test-token", async (input) => {
      pathname = new URL(new Request(input).url).pathname;
      return Response.json({
        code: "Ok",
        routes: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [origin.longitude, origin.latitude],
                ...destinations.map(({ latitude, longitude }) => [longitude, latitude]),
              ],
            },
            distance: 24,
            duration: 48,
            legs: destinations.map(() => ({ distance: 1, duration: 2 })),
          },
        ],
      });
    });

    const result = await adapter.preview({ origin, orderedDestinations: destinations });

    expect(decodeURIComponent(pathname).split("/").at(-1)?.split(";")).toEqual([
      `${origin.longitude},${origin.latitude}`,
      ...destinations.map(({ latitude, longitude }) => `${longitude},${latitude}`),
    ]);
    expect(result.legs).toHaveLength(24);
  });

  it.each([
    [[], "ROUTE_INVALID_REQUEST"],
    [Array.from({ length: 25 }, () => firstDestination), "ROUTE_INVALID_REQUEST"],
    [[{ latitude: 91, longitude: 123.9 }], "ROUTE_INVALID_REQUEST"],
    [[{ latitude: 10.32, longitude: Number.NaN }], "ROUTE_INVALID_REQUEST"],
  ] as const)("rejects invalid coordinate collections before fetch", async (destinations, code) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new MapboxRoutePreview("test-token", fetchImpl);

    await expect(
      adapter.preview({ origin, orderedDestinations: destinations }),
    ).rejects.toMatchObject({ code });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a malformed runtime coordinate object with the stable request failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new MapboxRoutePreview("test-token", fetchImpl);

    await expect(
      adapter.preview({ origin: null, orderedDestinations: [firstDestination] } as never),
    ).rejects.toMatchObject({ code: "ROUTE_INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [Response.json({ code: "NoRoute", routes: [] }), "ROUTE_NOT_FOUND"],
    [Response.json({ code: "NoSegment", routes: [] }), "ROUTE_NOT_FOUND"],
    [new Response("unavailable", { status: 503 }), "ROUTE_UNAVAILABLE"],
    [new Response("not-json"), "ROUTE_INVALID_RESPONSE"],
    [Response.json(null), "ROUTE_INVALID_RESPONSE"],
    [Response.json({ code: "Ok", routes: [] }), "ROUTE_INVALID_RESPONSE"],
    [Response.json({ code: "Ok", routes: [{}, {}] }), "ROUTE_INVALID_RESPONSE"],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "Point", coordinates: [[123.9, 10.32]] },
            distance: 1,
            duration: 1,
            legs: [{ distance: 1, duration: 1 }],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates: [[181, 10.32]] },
            distance: 1,
            duration: 1,
            legs: [{ distance: 1, duration: 1 }],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates: [[123.9, 10.32]] },
            distance: -1,
            duration: 1,
            legs: [{ distance: 1, duration: 1 }],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates: [[123.9, 10.32]] },
            distance: 1,
            duration: Number.POSITIVE_INFINITY,
            legs: [{ distance: 1, duration: 1 }],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates: [[123.9, 10.32]] },
            distance: 1,
            duration: 1,
            legs: [],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
    [
      Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates: [[123.9, 10.32]] },
            distance: 1,
            duration: 1,
            legs: [{ distance: "1", duration: 1 }],
          },
        ],
      }),
      "ROUTE_INVALID_RESPONSE",
    ],
  ] as const)("maps unusable provider output to %s", async (response, code) => {
    const adapter = new MapboxRoutePreview("test-token", async () => response);

    await expect(
      adapter.preview({ origin, orderedDestinations: [firstDestination] }),
    ).rejects.toMatchObject({ code });
  });

  it("maps an aborted request deadline to a stable timeout", async () => {
    const adapter = new MapboxRoutePreview(
      "test-token",
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
      1,
    );

    await expect(
      adapter.preview({ origin, orderedDestinations: [firstDestination] }),
    ).rejects.toMatchObject({ code: "ROUTE_TIMEOUT" });
  });

  it("maps missing configuration and network failure without logging sensitive request data", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      warnSpy,
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const token = "secret-route-preview-token";
    const missing = new MapboxRoutePreview("", async () => {
      throw new Error("fetch must not run");
    });
    const unavailable = new MapboxRoutePreview(token, async () => {
      throw new Error("provider unavailable");
    });

    await expect(
      missing.preview({ origin, orderedDestinations: [firstDestination] }),
    ).rejects.toEqual(new RoutePreviewError("ROUTE_UNCONFIGURED"));
    await expect(
      unavailable.preview({ origin, orderedDestinations: [firstDestination] }),
    ).rejects.toEqual(new RoutePreviewError("ROUTE_UNAVAILABLE"));
    const warnings = warnSpy.mock.calls.map(([message]) => JSON.parse(String(message)) as object);
    expect(warnings).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "provider_operation",
        operation: "MAPBOX_ROUTE_PREVIEW",
        result: "FAILURE",
        errorCode: "ROUTE_UNCONFIGURED",
      }),
      expect.objectContaining({
        level: "warn",
        event: "provider_operation",
        operation: "MAPBOX_ROUTE_PREVIEW",
        result: "FAILURE",
        errorCode: "ROUTE_UNAVAILABLE",
      }),
    ]);
    const serializedLogs = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    expect(serializedLogs).not.toContain(token);
    expect(serializedLogs).not.toContain("provider unavailable");
    expect(serializedLogs).not.toContain(String(origin.latitude));
    expect(serializedLogs).not.toContain(String(origin.longitude));
    for (const error of [
      new RoutePreviewError("ROUTE_UNCONFIGURED"),
      new RoutePreviewError("ROUTE_UNAVAILABLE"),
    ]) {
      expect(JSON.stringify(error)).not.toContain(token);
      expect(JSON.stringify(error)).not.toContain(String(origin.latitude));
      expect(JSON.stringify(error)).not.toContain(String(origin.longitude));
    }
    logSpies.forEach((spy) => spy.mockRestore());
  });
});
