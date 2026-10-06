import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  listAdminStaff: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));

import { GET as getContext } from "@/app/api/admin/context/route";

describe("Admin security boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["unauthenticated", "UNAUTHENTICATED"],
    ["missing capability", "FORBIDDEN"],
    ["out of scope", "FORBIDDEN"],
    ["malformed", "VALIDATION_FAILED"],
  ])("preserves the Core %s error envelope", async (_case, code) => {
    core.getAdminContext.mockResolvedValue({
      ok: false,
      error: { code, message: "boundary failure" },
      requestId: "request-boundary",
    });

    const response = await getContext(
      new Request("https://freshmarkets.ph/api/admin/context", {
        headers: {
          cookie: "session=boundary",
          "x-request-id": "request-boundary",
          "x-correlation-id": "correlation-boundary",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code, message: "boundary failure" },
      requestId: "request-boundary",
    });
  });

  it("forwards the browser cookie and request metadata to Core", async () => {
    core.getAdminContext.mockResolvedValue({ ok: true, value: {}, requestId: "r" });
    await getContext(
      new Request("https://freshmarkets.ph/api/admin/context", {
        headers: {
          cookie: "session=abc",
          "x-request-id": "request-1",
          "x-correlation-id": "correlation-1",
        },
      }),
    );

    const call = core.getAdminContext.mock.calls[0][0];
    expect(call).toEqual({
      requestId: expect.any(String),
      headers: {
        cookie: "session=abc",
        "x-request-id": call.requestId,
        "x-correlation-id": "correlation-1",
      },
    });
  });
});
