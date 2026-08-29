import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchAddressCandidates } = vi.hoisted(() => ({
  searchAddressCandidates: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: { searchAddressCandidates } } }));

import { GET } from "./route";

beforeEach(() => searchAddressCandidates.mockReset());

describe("address search route", () => {
  it("rejects an empty query before Core is called", async () => {
    const response = await GET(
      new Request("https://freshmarkets.ph/api/commerce/address-search?query=%20%20"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(searchAddressCandidates).not.toHaveBeenCalled();
  });

  it("forwards a trimmed provider-neutral query and optional proximity to Core", async () => {
    searchAddressCandidates.mockResolvedValue({
      ok: true,
      value: [],
      requestId: "request-search-1",
    });
    const response = await GET(
      new Request(
        "https://freshmarkets.ph/api/commerce/address-search?query=%20Ayala%20&latitude=10.32&longitude=123.9",
        { headers: { "x-request-id": "request-search-1" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(searchAddressCandidates).toHaveBeenCalledWith({
      requestId: "request-search-1",
      query: "Ayala",
      proximity: { latitude: 10.32, longitude: 123.9 },
    });
  });

  it("preserves stable provider errors without reflecting private query text", async () => {
    searchAddressCandidates.mockResolvedValue({
      ok: false,
      error: {
        code: "GEOCODER_RATE_LIMITED",
        message: "Address search is temporarily unavailable",
        requestId: "request-search-2",
      },
    });
    const sensitiveQuery = "Private blue gate beside my home";
    const response = await GET(
      new Request(
        `https://freshmarkets.ph/api/commerce/address-search?query=${encodeURIComponent(sensitiveQuery)}`,
        { headers: { "x-request-id": "request-search-2" } },
      ),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain("GEOCODER_RATE_LIMITED");
    expect(serialized).not.toContain(sensitiveQuery);
  });
});
