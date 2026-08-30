import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getRiderBatches: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));

import { GET } from "./route";

describe("GET /api/rider/batches", () => {
  beforeEach(() => {
    core.getRiderBatches.mockReset();
  });

  it("forwards only the authenticated request context and never accepts a client Rider ID", async () => {
    const result = {
      ok: true,
      value: { batches: [] },
      requestId: "core-request",
    } as const;
    core.getRiderBatches.mockResolvedValue(result);

    const response = await GET(
      new Request("https://freshmarkets.ph/api/rider/batches?riderId=rider-spoofed", {
        headers: {
          accept: "application/json",
          cookie: "session=rider-session",
          origin: "https://freshmarkets.ph",
          "x-request-id": "browser-request",
          "x-private-rider-id": "rider-spoofed",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(core.getRiderBatches).toHaveBeenCalledOnce();
    const request = core.getRiderBatches.mock.calls[0]![0];
    expect(request).toEqual({
      requestId: expect.any(String),
      headers: {
        accept: "application/json",
        cookie: "session=rider-session",
        origin: "https://freshmarkets.ph",
        "x-request-id": "browser-request",
      },
    });
    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.stringify(request)).not.toContain("rider-spoofed");
  });
});
