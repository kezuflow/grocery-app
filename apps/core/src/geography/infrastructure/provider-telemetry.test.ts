import { describe, expect, it } from "vitest";
import { MapboxGeocoder } from "./mapbox-geocoder";
import { MapboxRouteDistance } from "./mapbox-route-distance";
import { MapboxRoutePreview } from "./mapbox-route-preview";
import {
  observeProviderOperation,
  type ProviderTelemetryDependencies,
  type ProviderTelemetryEvent,
} from "./provider-telemetry";

const sensitive = {
  query: "Unit 4B, 1 Private Street, Cebu",
  token: "pk.private-server-token",
  phone: "+639171234567",
  instructions: "Blue gate; ask for Ana",
  cookie: "better-auth.session_token=private-session",
};

const addressFeature = {
  type: "Feature",
  id: "address.private",
  geometry: { type: "Point", coordinates: [123.8854, 10.3157] },
  properties: {
    mapbox_id: "address.private",
    feature_type: "address",
    full_address: sensitive.query,
    name: "1 Private Street",
    context: {
      address: { name: "1 Private Street" },
      place: { name: "Cebu City" },
      country: { name: "Philippines", country_code: "PH" },
    },
  },
};

function telemetry(events: ProviderTelemetryEvent[]): ProviderTelemetryDependencies {
  let time = 83;
  return {
    clock: () => (time += 17),
    sink: (event) => events.push(event),
  };
}

function successfulPreviewResponse(): Response {
  return Response.json({
    code: "Ok",
    routes: [
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [123.8854, 10.3157],
            [123.9, 10.32],
          ],
        },
        distance: 1_000,
        duration: 240,
        legs: [{ distance: 1_000, duration: 240 }],
      },
    ],
  });
}

describe("PII-safe Mapbox provider telemetry", () => {
  it("emits one bounded success event for every provider operation", async () => {
    const events: ProviderTelemetryEvent[] = [];
    const geocoder = new MapboxGeocoder(
      sensitive.token,
      async () => Response.json({ type: "FeatureCollection", features: [addressFeature] }),
      5_000,
      telemetry(events),
    );
    const distance = new MapboxRouteDistance(
      sensitive.token,
      async () => Response.json({ code: "Ok", routes: [{ distance: 1_000 }] }),
      telemetry(events),
    );
    const preview = new MapboxRoutePreview(
      sensitive.token,
      async () => successfulPreviewResponse(),
      5_000,
      telemetry(events),
    );

    await geocoder.search({ query: sensitive.query });
    await geocoder.reversePermanent({
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
    });
    await distance.routeDistance({
      origin: { latitude: 10.3157, longitude: 123.8854 },
      destination: { latitude: 10.32, longitude: 123.9 },
    });
    await preview.preview({
      origin: { latitude: 10.3157, longitude: 123.8854 },
      orderedDestinations: [{ latitude: 10.32, longitude: 123.9 }],
    });

    expect(events).toEqual([
      { operation: "MAPBOX_GEOCODER_SEARCH", durationMilliseconds: 17, result: "SUCCESS" },
      {
        operation: "MAPBOX_GEOCODER_REVERSE_PERMANENT",
        durationMilliseconds: 17,
        result: "SUCCESS",
      },
      { operation: "MAPBOX_ROUTE_DISTANCE", durationMilliseconds: 17, result: "SUCCESS" },
      { operation: "MAPBOX_ROUTE_PREVIEW", durationMilliseconds: 17, result: "SUCCESS" },
    ]);
    const serialized = JSON.stringify(events);
    for (const privateValue of [
      ...Object.values(sensitive),
      "123.8854",
      "10.3157",
      "api.mapbox.com",
      JSON.stringify(addressFeature),
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("emits only the stable adapter error code for provider failures", async () => {
    const events: ProviderTelemetryEvent[] = [];
    const geocoder = new MapboxGeocoder(
      sensitive.token,
      async () => new Response("private provider body", { status: 429 }),
      5_000,
      telemetry(events),
    );
    const distance = new MapboxRouteDistance(
      sensitive.token,
      async () => Response.json({ code: "NoRoute", message: sensitive.instructions }),
      telemetry(events),
    );
    const preview = new MapboxRoutePreview(
      sensitive.token,
      async () => new Response("private malformed body"),
      5_000,
      telemetry(events),
    );

    await expect(geocoder.search({ query: sensitive.query })).rejects.toMatchObject({
      code: "GEOCODER_RATE_LIMITED",
    });
    await expect(
      distance.routeDistance({
        origin: { latitude: 10.3157, longitude: 123.8854 },
        destination: { latitude: 10.32, longitude: 123.9 },
      }),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    await expect(
      preview.preview({
        origin: { latitude: 10.3157, longitude: 123.8854 },
        orderedDestinations: [{ latitude: 10.32, longitude: 123.9 }],
      }),
    ).rejects.toMatchObject({ code: "ROUTE_INVALID_RESPONSE" });

    expect(events).toEqual([
      {
        operation: "MAPBOX_GEOCODER_SEARCH",
        durationMilliseconds: 17,
        result: "FAILURE",
        errorCode: "GEOCODER_RATE_LIMITED",
      },
      {
        operation: "MAPBOX_ROUTE_DISTANCE",
        durationMilliseconds: 17,
        result: "FAILURE",
        errorCode: "ROUTE_NOT_FOUND",
      },
      {
        operation: "MAPBOX_ROUTE_PREVIEW",
        durationMilliseconds: 17,
        result: "FAILURE",
        errorCode: "ROUTE_INVALID_RESPONSE",
      },
    ]);
    const serialized = JSON.stringify(events);
    for (const privateValue of Object.values(sensitive))
      expect(serialized).not.toContain(privateValue);
  });

  it("does not let telemetry failure change provider success or domain failure", async () => {
    const throwingTelemetry: ProviderTelemetryDependencies = {
      clock: () => 100,
      sink: () => {
        throw new Error("telemetry unavailable");
      },
    };
    const geocoder = new MapboxGeocoder(
      sensitive.token,
      async () => Response.json({ type: "FeatureCollection", features: [] }),
      5_000,
      throwingTelemetry,
    );
    const preview = new MapboxRoutePreview(
      sensitive.token,
      async () => Response.json({ code: "NoRoute", routes: [] }),
      5_000,
      throwingTelemetry,
    );

    await expect(geocoder.search({ query: sensitive.query })).resolves.toEqual([]);
    await expect(
      preview.preview({
        origin: { latitude: 10.3157, longitude: 123.8854 },
        orderedDestinations: [{ latitude: 10.32, longitude: 123.9 }],
      }),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
  });

  it("replaces an unrecognized error code instead of logging arbitrary exception data", async () => {
    const events: ProviderTelemetryEvent[] = [];

    await expect(
      observeProviderOperation("MAPBOX_ROUTE_PREVIEW", telemetry(events), async () => {
        throw { code: "PRIVATE_ADDRESS", detail: sensitive.query };
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });

    expect(events).toEqual([
      {
        operation: "MAPBOX_ROUTE_PREVIEW",
        durationMilliseconds: 17,
        result: "FAILURE",
        errorCode: "PROVIDER_OPERATION_FAILED",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(sensitive.query);
  });

  it.each([
    ["non-finite", [Number.NaN, Number.POSITIVE_INFINITY], 0],
    ["backward", [200, 100], 0],
    ["over cap", [100, 100_100], 60_000],
  ] as const)(
    "bounds a %s clock without changing provider success",
    async (_case, times, duration) => {
      const events: ProviderTelemetryEvent[] = [];
      let index = 0;

      await expect(
        observeProviderOperation(
          "MAPBOX_ROUTE_DISTANCE",
          {
            clock: () => times[index++] ?? times.at(-1)!,
            sink: (event) => events.push(event),
          },
          async () => "provider-result",
        ),
      ).resolves.toBe("provider-result");

      expect(events).toEqual([
        {
          operation: "MAPBOX_ROUTE_DISTANCE",
          durationMilliseconds: duration,
          result: "SUCCESS",
        },
      ]);
    },
  );

  it("keeps the domain failure when both clock reads throw", async () => {
    const events: ProviderTelemetryEvent[] = [];
    const domainError = { code: "ROUTE_NOT_FOUND" } as const;

    await expect(
      observeProviderOperation(
        "MAPBOX_ROUTE_DISTANCE",
        {
          clock: () => {
            throw new Error("clock unavailable");
          },
          sink: (event) => events.push(event),
        },
        async () => {
          throw domainError;
        },
      ),
    ).rejects.toBe(domainError);

    expect(events).toEqual([
      {
        operation: "MAPBOX_ROUTE_DISTANCE",
        durationMilliseconds: 0,
        result: "FAILURE",
        errorCode: "ROUTE_NOT_FOUND",
      },
    ]);
  });
});
