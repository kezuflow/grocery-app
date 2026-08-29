import { describe, expect, it } from "vitest";
import { GeocoderError, MapboxGeocoder } from "./mapbox-geocoder";

const CEBU_ADDRESS_FEATURE = {
  type: "Feature",
  id: "address.cebu-test",
  geometry: { type: "Point", coordinates: [123.8854, 10.3157] },
  properties: {
    mapbox_id: "address.cebu-test",
    feature_type: "address",
    full_address: "1 V. Rama Avenue, Guadalupe, Cebu City, Cebu 6000, Philippines",
    name: "1 V. Rama Avenue",
    coordinates: { longitude: 123.8854, latitude: 10.3157, accuracy: "rooftop" },
    context: {
      address: {
        mapbox_id: "address.cebu-test",
        address_number: "1",
        street_name: "V. Rama Avenue",
        name: "1 V. Rama Avenue",
      },
      neighborhood: { mapbox_id: "neighborhood.guadalupe", name: "Guadalupe" },
      postcode: { mapbox_id: "postcode.6000", name: "6000" },
      place: { mapbox_id: "place.cebu-city", name: "Cebu City" },
      region: { mapbox_id: "region.cebu", name: "Cebu" },
      country: {
        mapbox_id: "country.ph",
        name: "Philippines",
        country_code: "PH",
        country_code_alpha_3: "PHL",
      },
    },
  },
};

const CEBU_PLACE_FEATURE = {
  type: "Feature",
  id: "place.cebu-city",
  geometry: { type: "Point", coordinates: [123.8854, 10.3157] },
  properties: {
    mapbox_id: "place.cebu-city",
    feature_type: "place",
    full_address: "Cebu City, Cebu, Philippines",
    name: "Cebu City",
    coordinates: { longitude: 123.8854, latitude: 10.3157 },
    context: {
      region: { mapbox_id: "region.cebu", name: "Cebu" },
      country: {
        mapbox_id: "country.ph",
        name: "Philippines",
        country_code: "PH",
        country_code_alpha_3: "PHL",
      },
    },
  },
};

describe("Mapbox geocoder adapter", () => {
  it("uses temporary Cebu-biased Philippines forward search and maps provider-neutral candidates", async () => {
    let requested: Request | undefined;
    const adapter = new MapboxGeocoder("test-token", async (input, init) => {
      requested = new Request(input, init);
      return Response.json({ type: "FeatureCollection", features: [CEBU_ADDRESS_FEATURE] });
    });

    const candidates = await adapter.search({ query: "V Rama Cebu" });

    const url = requested ? new URL(requested.url) : undefined;
    expect(requested?.method).toBe("GET");
    expect(url?.pathname).toBe("/search/geocode/v6/forward");
    expect(url ? Object.fromEntries(url.searchParams) : {}).toEqual({
      q: "V Rama Cebu",
      country: "PH",
      proximity: "123.8854,10.3157",
      limit: "5",
      access_token: "test-token",
    });
    expect(url?.searchParams.has("permanent")).toBe(false);
    expect(candidates).toEqual([
      {
        candidateKey: "address.cebu-test",
        displayAddress: "1 V. Rama Avenue, Guadalupe, Cebu City, Cebu 6000, Philippines",
        coordinate: { latitude: 10.3157, longitude: 123.8854 },
        components: {
          addressLine1: "1 V. Rama Avenue",
          addressLine2: null,
          barangay: "Guadalupe",
          city: "Cebu City",
          region: "Cebu",
          postalCode: "6000",
          countryCode: "PH",
        },
        accuracy: "rooftop",
      },
    ]);
  });

  it("uses a valid caller proximity without changing the bounded result limit", async () => {
    let requestedUrl: URL | undefined;
    const adapter = new MapboxGeocoder("test-token", async (input) => {
      requestedUrl = new URL(new Request(input).url);
      return Response.json({ type: "FeatureCollection", features: [] });
    });

    await adapter.search({
      query: "Mandaue",
      proximity: { latitude: 10.3236, longitude: 123.9222 },
    });

    expect(requestedUrl?.searchParams.get("proximity")).toBe("123.9222,10.3236");
    expect(requestedUrl?.searchParams.get("limit")).toBe("5");
  });

  it("uses permanent Philippines reverse geocoding for finalization", async () => {
    let requested: Request | undefined;
    const adapter = new MapboxGeocoder("test-token", async (input, init) => {
      requested = new Request(input, init);
      return Response.json({ type: "FeatureCollection", features: [CEBU_ADDRESS_FEATURE] });
    });

    const finalized = await adapter.reversePermanent({
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
    });

    const url = requested ? new URL(requested.url) : undefined;
    expect(url?.pathname).toBe("/search/geocode/v6/reverse");
    expect(url ? Object.fromEntries(url.searchParams) : {}).toEqual({
      longitude: "123.8854",
      latitude: "10.3157",
      country: "PH",
      permanent: "true",
      access_token: "test-token",
    });
    expect(finalized).toEqual({
      provider: "MAPBOX",
      providerReference: "address.cebu-test",
      displayAddress: "1 V. Rama Avenue, Guadalupe, Cebu City, Cebu 6000, Philippines",
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
      components: {
        addressLine1: "1 V. Rama Avenue",
        addressLine2: null,
        barangay: "Guadalupe",
        city: "Cebu City",
        region: "Cebu",
        postalCode: "6000",
        countryCode: "PH",
      },
      accuracy: "rooftop",
    });
  });

  it.each([
    [401, "GEOCODER_UNAUTHORIZED"],
    [403, "GEOCODER_UNAUTHORIZED"],
    [429, "GEOCODER_RATE_LIMITED"],
    [500, "GEOCODER_UNAVAILABLE"],
    [503, "GEOCODER_UNAVAILABLE"],
  ] as const)("maps provider HTTP %s to %s", async (status, code) => {
    const adapter = new MapboxGeocoder(
      "test-token",
      async () => new Response("provider failure", { status }),
    );

    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({ code });
  });

  it("maps an aborted request deadline to a stable timeout", async () => {
    const adapter = new MapboxGeocoder(
      "test-token",
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
      1,
    );

    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_TIMEOUT",
    });
  });

  it("returns no candidates for an empty forward result", async () => {
    const adapter = new MapboxGeocoder("test-token", async () =>
      Response.json({ type: "FeatureCollection", features: [] }),
    );

    await expect(adapter.search({ query: "missing" })).resolves.toEqual([]);
  });

  it("rejects an empty permanent reverse result", async () => {
    const adapter = new MapboxGeocoder("test-token", async () =>
      Response.json({ type: "FeatureCollection", features: [] }),
    );

    await expect(
      adapter.reversePermanent({
        coordinate: { latitude: 10.3157, longitude: 123.8854 },
      }),
    ).rejects.toMatchObject({ code: "GEOCODER_NO_RESULTS" });
  });

  it.each([
    { ...CEBU_ADDRESS_FEATURE, geometry: { type: "Point", coordinates: [181, 10.3157] } },
    { ...CEBU_ADDRESS_FEATURE, geometry: { type: "Point", coordinates: [123.8854, 91] } },
    { ...CEBU_ADDRESS_FEATURE, geometry: { type: "Point", coordinates: ["123.8854", 10.3157] } },
  ])("discards features with malformed coordinates", async (feature) => {
    const adapter = new MapboxGeocoder("test-token", async () =>
      Response.json({ type: "FeatureCollection", features: [feature] }),
    );

    await expect(adapter.search({ query: "Cebu" })).resolves.toEqual([]);
  });

  it("rejects malformed input coordinates before calling Mapbox", async () => {
    const adapter = new MapboxGeocoder("test-token", async () => {
      throw new Error("fetch must not run");
    });

    await expect(
      adapter.reversePermanent({ coordinate: { latitude: 91, longitude: 123.8854 } }),
    ).rejects.toMatchObject({ code: "GEOCODER_INVALID_REQUEST" });
  });

  it("discards provider features that contain no usable structured address", async () => {
    const feature = {
      ...CEBU_ADDRESS_FEATURE,
      properties: {
        ...CEBU_ADDRESS_FEATURE.properties,
        full_address: "",
        name: "",
        context: { country: CEBU_ADDRESS_FEATURE.properties.context.country },
      },
    };
    const adapter = new MapboxGeocoder("test-token", async () =>
      Response.json({ type: "FeatureCollection", features: [feature] }),
    );

    await expect(adapter.search({ query: "Cebu" })).resolves.toEqual([]);
    await expect(
      adapter.reversePermanent({
        coordinate: { latitude: 10.3157, longitude: 123.8854 },
      }),
    ).rejects.toMatchObject({ code: "GEOCODER_NO_RESULTS" });
  });

  it.each(["place", "locality", "neighborhood", "postcode"])(
    "discards well-formed %s-only forward results as non-deliverable",
    async (featureType) => {
      const feature = {
        ...CEBU_PLACE_FEATURE,
        id: `${featureType}.cebu-test`,
        properties: {
          ...CEBU_PLACE_FEATURE.properties,
          mapbox_id: `${featureType}.cebu-test`,
          feature_type: featureType,
        },
      };
      const adapter = new MapboxGeocoder("test-token", async () =>
        Response.json({ type: "FeatureCollection", features: [feature] }),
      );

      await expect(adapter.search({ query: "Cebu City" })).resolves.toEqual([]);
    },
  );

  it.each(["place", "locality", "neighborhood", "postcode"])(
    "rejects well-formed %s-only permanent reverse results as non-deliverable",
    async (featureType) => {
      const feature = {
        ...CEBU_PLACE_FEATURE,
        id: `${featureType}.cebu-test`,
        properties: {
          ...CEBU_PLACE_FEATURE.properties,
          mapbox_id: `${featureType}.cebu-test`,
          feature_type: featureType,
        },
      };
      const adapter = new MapboxGeocoder("test-token", async () =>
        Response.json({ type: "FeatureCollection", features: [feature] }),
      );

      await expect(
        adapter.reversePermanent({
          coordinate: { latitude: 10.3157, longitude: 123.8854 },
        }),
      ).rejects.toMatchObject({ code: "GEOCODER_NO_RESULTS" });
    },
  );

  it("maps non-JSON provider bodies to an invalid-response error", async () => {
    const adapter = new MapboxGeocoder("test-token", async () => new Response("not-json"));

    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_INVALID_RESPONSE",
    });
  });

  it("maps a JSON null provider body to an invalid-response error", async () => {
    const adapter = new MapboxGeocoder("test-token", async () => Response.json(null));

    await expect(adapter.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_INVALID_RESPONSE",
    });
  });

  it("fails closed without exposing or using an absent access token", async () => {
    const adapter = new MapboxGeocoder("", async () => {
      throw new Error("fetch must not run");
    });

    await expect(adapter.search({ query: "Cebu" })).rejects.toEqual(
      new GeocoderError("GEOCODER_UNCONFIGURED"),
    );
  });
});
