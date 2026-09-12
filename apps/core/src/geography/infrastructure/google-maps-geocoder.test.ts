import { describe, expect, it } from "vitest";
import { GeocoderError, GoogleMapsGeocoder } from "./google-maps-geocoder";

const result = {
  place_id: "google-place-1",
  formatted_address: "123 Jose Rizal Street, Cebu City, 6000 Cebu, Philippines",
  geometry: {
    location: { lat: 10.3157, lng: 123.8854 },
    location_type: "ROOFTOP",
  },
  address_components: [
    { long_name: "123", short_name: "123", types: ["street_number"] },
    { long_name: "Jose Rizal Street", short_name: "Jose Rizal St", types: ["route"] },
    { long_name: "Central", short_name: "Central", types: ["sublocality_level_1"] },
    { long_name: "Cebu City", short_name: "Cebu City", types: ["locality"] },
    { long_name: "Cebu", short_name: "Cebu", types: ["administrative_area_level_1"] },
    { long_name: "6000", short_name: "6000", types: ["postal_code"] },
    { long_name: "Philippines", short_name: "PH", types: ["country"] },
  ],
};

describe("Google Maps geocoder", () => {
  it("biases searches to Cebu and maps provider fields into the public candidate", async () => {
    let requested: URL | undefined;
    const adapter = new GoogleMapsGeocoder("server-key", async (input) => {
      requested = new URL(new Request(input).url);
      return Response.json({ status: "OK", results: [result] });
    });
    await expect(adapter.search({ query: "Jose Rizal" })).resolves.toEqual([
      {
        candidateKey: "google-place-1",
        displayAddress: result.formatted_address,
        coordinate: { latitude: 10.3157, longitude: 123.8854 },
        components: {
          addressLine1: "123 Jose Rizal Street",
          addressLine2: null,
          barangay: "Central",
          city: "Cebu City",
          region: "Cebu",
          postalCode: "6000",
          countryCode: "PH",
        },
        accuracy: "ROOFTOP",
      },
    ]);
    expect(`${requested!.origin}${requested!.pathname}`).toBe(
      "https://maps.googleapis.com/maps/api/geocode/json",
    );
    expect(requested?.searchParams.get("key")).toBe("server-key");
    expect(requested?.searchParams.get("components")).toBe("country:PH");
    expect(requested?.searchParams.get("bounds")).toContain("|");
  });

  it("reverse geocodes the confirmed pin and keeps the provider reference server-side", async () => {
    let requested: URL | undefined;
    const adapter = new GoogleMapsGeocoder("server-key", async (input) => {
      requested = new URL(new Request(input).url);
      return Response.json({ status: "OK", results: [result] });
    });
    await expect(
      adapter.reversePermanent({ coordinate: { latitude: 10.3157, longitude: 123.8854 } }),
    ).resolves.toMatchObject({ provider: "GOOGLE_MAPS", providerReference: "google-place-1" });
    expect(requested?.searchParams.get("latlng")).toBe("10.3157,123.8854");
  });

  it("uses caller proximity only as a bounded search bias", async () => {
    let requested: URL | undefined;
    const adapter = new GoogleMapsGeocoder("server-key", async (input) => {
      requested = new URL(new Request(input).url);
      return Response.json({ status: "ZERO_RESULTS", results: [] });
    });
    await adapter.search({
      query: "Mandaue",
      proximity: { latitude: 10.34, longitude: 123.94 },
    });
    expect(requested?.searchParams.get("bounds")).toBe("9.84,123.44|10.84,124.44");
    expect(requested?.searchParams.get("components")).toBe("country:PH");
  });

  it("keeps temporary reverse results provider-neutral", async () => {
    const adapter = new GoogleMapsGeocoder("server-key", async () =>
      Response.json({ status: "OK", results: [result] }),
    );
    const candidate = await adapter.reverseTemporary({
      coordinate: { latitude: 10.3157, longitude: 123.8854 },
    });
    expect(candidate.candidateKey).toBe("google-place-1");
    expect(candidate).not.toHaveProperty("providerReference");
  });

  it.each([
    ["ZERO_RESULTS", "GEOCODER_NO_RESULTS"],
    ["REQUEST_DENIED", "GEOCODER_UNAUTHORIZED"],
    ["OVER_QUERY_LIMIT", "GEOCODER_RATE_LIMITED"],
    ["UNKNOWN_ERROR", "GEOCODER_UNAVAILABLE"],
  ] as const)("maps %s to %s", async (status, code) => {
    const adapter = new GoogleMapsGeocoder("server-key", async () =>
      Response.json({ status, results: [] }),
    );
    await expect(
      adapter.reverseTemporary({ coordinate: { latitude: 10.3157, longitude: 123.8854 } }),
    ).rejects.toMatchObject({ code });
  });

  it("fails closed without a server key", async () => {
    const adapter = new GoogleMapsGeocoder("", async () => {
      throw new Error("fetch must not run");
    });
    await expect(adapter.search({ query: "Cebu" })).rejects.toEqual(
      new GeocoderError("GEOCODER_UNCONFIGURED"),
    );
  });

  it("rejects invalid coordinates before calling Google", async () => {
    let called = false;
    const adapter = new GoogleMapsGeocoder("server-key", async () => {
      called = true;
      return Response.json({ status: "ZERO_RESULTS", results: [] });
    });
    await expect(
      adapter.reverseTemporary({ coordinate: { latitude: 91, longitude: 123.9 } }),
    ).rejects.toMatchObject({ code: "GEOCODER_INVALID_REQUEST" });
    expect(called).toBe(false);
  });

  it("maps timeout, invalid JSON, and malformed result envelopes to stable failures", async () => {
    const timeout = new GoogleMapsGeocoder("server-key", async () => {
      throw new DOMException("deadline", "TimeoutError");
    });
    await expect(timeout.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_TIMEOUT",
    });

    const invalidJson = new GoogleMapsGeocoder("server-key", async () => new Response("not-json"));
    await expect(invalidJson.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_INVALID_RESPONSE",
    });

    const malformed = new GoogleMapsGeocoder("server-key", async () =>
      Response.json({ status: "OK", results: null }),
    );
    await expect(malformed.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_INVALID_RESPONSE",
    });
  });

  it("discards results that cannot form a structured Philippine address", async () => {
    const adapter = new GoogleMapsGeocoder("server-key", async () =>
      Response.json({
        status: "OK",
        results: [{ ...result, address_components: [] }],
      }),
    );
    await expect(adapter.search({ query: "Cebu" })).resolves.toEqual([]);
  });
});
