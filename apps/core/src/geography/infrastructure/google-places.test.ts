import { describe, expect, it, vi } from "vitest";
import { GooglePlaces, autocompleteSchema, predictionSchema } from "./google-places";

const sessionToken = "12345678-1234-4234-8234-123456789012";
const input = { requestId: "places-test", query: "Ayala", sessionToken };
const details = {
  id: "place_1",
  displayName: { text: "Ayala Center Cebu" },
  formattedAddress: "Cebu, Philippines",
  location: { latitude: 10.3, longitude: 123.9 },
  addressComponents: [
    { longText: "Philippines", shortText: "PH", types: ["country"] },
    { longText: "Cebu City", types: ["locality"] },
  ],
};
describe("Google Places autocomplete boundary", () => {
  it("returns predictions without fetching details and keeps the credential in a header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        suggestions: [{ placePrediction: { placeId: "place_1", text: { text: "Ayala Cebu" } } }],
      }),
    );
    expect(await new GooglePlaces("private-key", fetcher).autocomplete(input)).toEqual([
      { candidateKey: "place_1", displayAddress: "Ayala Cebu" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(new Headers(options?.headers).get("X-Goog-Api-Key")).toBe("private-key");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      sessionToken,
      includedRegionCodes: ["ph"],
      locationBias: { circle: { center: { latitude: 10.3157, longitude: 123.8854 } } },
    });
  });
  it("resolves only the selected prediction with the same session and a minimal field mask", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(details));
    const result = await new GooglePlaces("private-key", fetcher).resolve({
      requestId: "test",
      candidateKey: "place_1",
      sessionToken,
    });
    expect(result.coordinate).toEqual(details.location);
    expect(result.components.city).toBe("Cebu City");
    expect(result.components.addressLine1).toBe("Ayala Center Cebu");
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get("sessionToken")).toBe(
      sessionToken,
    );
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-Goog-FieldMask")).toBe(
      "id,formattedAddress,location,addressComponents,displayName",
    );
  });
  it.each([
    [403, "GEOCODER_UNAUTHORIZED"],
    [429, "GEOCODER_RATE_LIMITED"],
    [500, "GEOCODER_UNAVAILABLE"],
  ])("maps HTTP %s to a safe error", async (status, code) => {
    const adapter = new GooglePlaces(
      "private-key",
      async () => new Response("secret provider response", { status: Number(status) }),
    );
    await expect(adapter.autocomplete(input)).rejects.toMatchObject({ code, message: code });
  });
  it("rejects malformed coordinates, country and mismatched details", async () => {
    for (const payload of [
      { ...details, location: { latitude: 100, longitude: 123 } },
      { ...details, id: "other" },
      { ...details, addressComponents: [] },
    ]) {
      await expect(
        new GooglePlaces("key", async () => Response.json(payload)).resolve({
          requestId: "test",
          candidateKey: "place_1",
          sessionToken,
        }),
      ).rejects.toThrow();
    }
  });
  it("accepts an empty prediction response and rejects invalid provider data", async () => {
    expect(
      await new GooglePlaces("key", async () => Response.json({})).autocomplete(input),
    ).toEqual([]);
    await expect(
      new GooglePlaces("key", async () => Response.json({ suggestions: [{}] })).autocomplete(input),
    ).rejects.toMatchObject({ code: "GEOCODER_INVALID_RESPONSE" });
  });
  it("validates session, input and detail resource identifiers before provider access", () => {
    expect(autocompleteSchema.safeParse({ ...input, query: "a" }).success).toBe(false);
    expect(autocompleteSchema.safeParse({ ...input, sessionToken: "invalid" }).success).toBe(false);
    expect(
      predictionSchema.safeParse({
        requestId: "test",
        candidateKey: "../other?key=bad",
        sessionToken,
      }).success,
    ).toBe(false);
  });
});
