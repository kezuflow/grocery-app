import { beforeEach, describe, expect, it, vi } from "vitest";

const { reverseAddressCandidate } = vi.hoisted(() => ({
  reverseAddressCandidate: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: { reverseAddressCandidate } } }));

import { POST } from "@/app/api/commerce/address-reverse/route";

function post(body: unknown, requestId = "request-reverse-1") {
  return POST(
    new Request("https://freshmarkets.ph/api/commerce/address-reverse", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => reverseAddressCandidate.mockReset());

describe("address reverse route", () => {
  it("forwards a valid private coordinate body to Core", async () => {
    reverseAddressCandidate.mockResolvedValue({
      ok: true,
      value: { candidateKey: "candidate" },
      requestId: "request-reverse-1",
    });
    const coordinate = { latitude: 10.32, longitude: 123.9 };

    const response = await post({ coordinate });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(reverseAddressCandidate).toHaveBeenCalledWith({
      requestId: "request-reverse-1",
      coordinate,
    });
  });

  it("rejects invalid coordinates before Core is called", async () => {
    const response = await post({ coordinate: { latitude: 91, longitude: 123.9 } });

    expect(response.status).toBe(400);
    expect(reverseAddressCandidate).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
  });
});
