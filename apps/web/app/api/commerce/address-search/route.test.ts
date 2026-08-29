import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchAddressCandidates } = vi.hoisted(() => ({
  searchAddressCandidates: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: { searchAddressCandidates } } }));

import { GET, POST } from "./route";

function post(body: unknown, requestId = "request-search-1") {
  return POST(
    new Request("https://freshmarkets.ph/api/commerce/address-search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => searchAddressCandidates.mockReset());

describe("address search route", () => {
  it("rejects an empty query before Core is called", async () => {
    const response = await post({ query: "  " });

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
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
    const response = await post({
      query: " Ayala ",
      proximity: { latitude: 10.32, longitude: 123.9 },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(searchAddressCandidates).toHaveBeenCalledWith({
      requestId: "request-search-1",
      query: "Ayala",
      proximity: { latitude: 10.32, longitude: 123.9 },
    });
  });

  it("rejects GET query input without forwarding sensitive URL data to Core", async () => {
    const response = await GET(
      new Request(
        "https://freshmarkets.ph/api/commerce/address-search?query=Private%20home&latitude=10.32&longitude=123.9",
      ),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(searchAddressCandidates).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("Private home");
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
    const response = await post({ query: sensitiveQuery }, "request-search-2");
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(serialized).toContain("GEOCODER_RATE_LIMITED");
    expect(serialized).not.toContain(sensitiveQuery);
  });
});
