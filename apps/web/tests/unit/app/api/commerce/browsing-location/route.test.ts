import { beforeEach, describe, expect, it, vi } from "vitest";

const { confirmBrowsingLocation } = vi.hoisted(() => ({
  confirmBrowsingLocation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: { confirmBrowsingLocation } } }));

import { POST } from "@/app/api/commerce/browsing-location/route";

function post(body: unknown, requestId = "request-reverse-1") {
  return POST(
    new Request("https://freshmarkets.ph/api/commerce/browsing-location", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => confirmBrowsingLocation.mockReset());

describe("browsing-location confirmation route", () => {
  it("forwards a valid private coordinate body to Core", async () => {
    confirmBrowsingLocation.mockResolvedValue({
      ok: true,
      value: { candidateKey: "candidate" },
      requestId: "request-reverse-1",
    });
    const coordinate = { latitude: 10.32, longitude: 123.9 };

    const response = await post({ coordinate });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(confirmBrowsingLocation).toHaveBeenCalledWith({
      requestId: "request-reverse-1",
      coordinate,
    });
  });

  it("rejects invalid coordinates before Core is called", async () => {
    const response = await post({ coordinate: { latitude: 91, longitude: 123.9 } });

    expect(response.status).toBe(400);
    expect(confirmBrowsingLocation).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("returns a no-store failure when permanent confirmation is unavailable", async () => {
    confirmBrowsingLocation.mockResolvedValue({
      ok: false,
      error: {
        code: "GEOCODER_UNAUTHORIZED",
        message: "Address confirmation is temporarily unavailable",
        requestId: "provider-denied",
      },
    });
    const response = await post({ coordinate: { latitude: 10.32, longitude: 123.9 } });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "GEOCODER_UNAUTHORIZED" },
    });
  });
});
