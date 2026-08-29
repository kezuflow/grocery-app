import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveServiceability } = vi.hoisted(() => ({ resolveServiceability: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: { resolveServiceability } } }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://freshmarkets.ph/api/serviceability", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "serviceability-1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resolveServiceability.mockReset());

describe("serviceability route", () => {
  it("rejects invalid coordinates before Core is called", async () => {
    const response = await POST(request({ latitude: 91, longitude: 123.9 }));
    expect(response.status).toBe(400);
    expect(resolveServiceability).not.toHaveBeenCalled();
  });

  it("forwards confirmed coordinates and structured components without choosing a location", async () => {
    resolveServiceability.mockResolvedValue({
      ok: true,
      value: { serviceable: true },
      requestId: "serviceability-1",
    });
    const addressComponents = { city: "Cebu City", barangay: "Luz" };
    await POST(request({ latitude: 10.3173, longitude: 123.9058, addressComponents }));

    expect(resolveServiceability).toHaveBeenCalledWith({
      requestId: "serviceability-1",
      latitude: 10.3173,
      longitude: 123.9058,
      addressComponents,
    });
    expect(resolveServiceability.mock.calls[0][0]).not.toHaveProperty("locationId");
  });
});
