import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreEntrypoint } from "../../index";

const point = { latitude: 10.32, longitude: 123.9 };
const core = () =>
  new CoreEntrypoint(
    {} as never,
    {
      DB: env.DB,
      ENVIRONMENT: "test",
      MAPBOX_ACCESS_TOKEN: "test-secret-token",
      BETTER_AUTH_URL: "https://core.example.invalid",
      TRUSTED_ORIGINS: "https://core.example.invalid",
    } as never,
  );
const feature = {
  type: "Feature",
  id: "private-provider-reference",
  geometry: { type: "Point", coordinates: [123.901, 10.321] },
  properties: {
    mapbox_id: "private-provider-reference",
    feature_type: "address",
    name: "Permanent entrance",
    full_address: "Permanent entrance, Cebu",
    context: { place: { name: "Cebu" }, country: { country_code: "PH" } },
  },
};
afterEach(() => vi.restoreAllMocks());

describe("browsing-location confirmation", () => {
  it("permanently finalizes anonymous coordinates and returns only current browsing information", async () => {
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ features: [feature] }));
    const result = await core().confirmBrowsingLocation({
      requestId: "confirm-browser",
      coordinate: point,
    });
    const url = new URL(String(fetched.mock.calls[0]?.[0]));
    expect(url.searchParams.get("permanent")).toBe("true");
    expect(url.searchParams.get("latitude")).toBe(String(point.latitude));
    expect(result).toMatchObject({
      ok: true,
      value: {
        displayAddress: "Permanent entrance, Cebu",
        coordinate: point,
        serviceability: {
          serviceable: true,
          coordinate: point,
          fulfillmentLocation: { id: "location-cebu-central" },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-provider-reference");
    expect(JSON.stringify(result)).not.toContain("test-secret-token");
  });

  it("does not turn provider denial into successful confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private provider error", { status: 403 }),
    );
    const result = await core().confirmBrowsingLocation({
      requestId: "confirm-denied",
      coordinate: point,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "GEOCODER_UNAUTHORIZED" } });
    expect(result).not.toHaveProperty("value");
    expect(JSON.stringify(result)).not.toContain("private provider error");
  });

  it("rejects invalid coordinates before the provider and rechecks coverage at the selected entrance", async () => {
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ features: [feature] }));
    expect(
      await core().confirmBrowsingLocation({
        requestId: "bad-point",
        coordinate: { ...point, latitude: 91 },
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(fetched).not.toHaveBeenCalled();
    expect(
      await core().confirmBrowsingLocation({
        requestId: "outside",
        coordinate: { latitude: 0, longitude: 0 },
      }),
    ).toMatchObject({
      ok: true,
      value: { coordinate: { latitude: 0, longitude: 0 }, serviceability: { serviceable: false } },
    });
  });
});
