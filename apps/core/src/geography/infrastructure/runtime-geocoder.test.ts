import { describe, expect, it } from "vitest";
import { buildGeocoderPort } from "./runtime-geocoder";

describe("runtime geocoder selection", () => {
  it("builds Mapbox from the existing Core access-token binding", async () => {
    let requestedUrl: URL | undefined;
    const port = buildGeocoderPort({ MAPBOX_ACCESS_TOKEN: "secret-token" }, async (input) => {
      requestedUrl = new URL(new Request(input).url);
      return Response.json({ type: "FeatureCollection", features: [] });
    });

    await expect(port.search({ query: "Cebu" })).resolves.toEqual([]);
    expect(requestedUrl?.searchParams.get("access_token")).toBe("secret-token");
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
