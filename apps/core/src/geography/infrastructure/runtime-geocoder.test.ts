import { describe, expect, it } from "vitest";
import { buildGeocoderPort } from "./runtime-geocoder";

describe("runtime geocoder selection", () => {
  it("builds Google Maps from the server-only API-key binding", async () => {
    let requestedUrl: URL | undefined;
    const port = buildGeocoderPort({ GOOGLE_MAPS_SERVER_KEY: "secret-key" }, async (input) => {
      requestedUrl = new URL(new Request(input).url);
      return Response.json({ status: "ZERO_RESULTS", results: [] });
    });

    await expect(port.search({ query: "Cebu" })).resolves.toEqual([]);
    expect(requestedUrl?.searchParams.get("key")).toBe("secret-key");
  });

  it("fails closed when the Core access-token binding is absent", async () => {
    const port = buildGeocoderPort({}, async () => {
      throw new Error("fetch must not run");
    });

    await expect(port.search({ query: "Cebu" })).rejects.toMatchObject({
      code: "GEOCODER_UNCONFIGURED",
    });
  });
});
