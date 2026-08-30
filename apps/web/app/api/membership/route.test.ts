import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMembershipExperience } = vi.hoisted(() => ({
  getMembershipExperience: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { CORE: { getMembershipExperience } } }));

import { GET } from "./route";

beforeEach(() => getMembershipExperience.mockReset());

describe("membership account surface", () => {
  it("forwards the Core-owned experience without Web-owned membership facts", async () => {
    const value = {
      offer: {
        offerId: "offer-membership-monthly",
        code: "MEMBERSHIP_MONTHLY",
        name: "FreshMarkets Membership",
        amountMinor: 29900,
        currency: "PHP",
        billingInterval: "CALENDAR_MONTH",
      },
      subscription: null,
      introductoryTrial: {
        eligible: false,
        status: "AUTHORIZATION_REQUIRED",
        duration: "CALENDAR_MONTH",
      },
      recurringAuthorization: { ready: false, status: "REQUIRED" },
      actions: {},
    };
    getMembershipExperience.mockResolvedValue({ ok: true, value });
    const response = await GET(
      new Request("https://freshmarkets.ph/api/membership", { headers: { cookie: "s=1" } }),
    );
    expect(await response.json()).toMatchObject({ ok: true, value });
    expect(getMembershipExperience).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.any(String), headers: expect.any(Object) }),
    );
  });

  it("preserves unauthenticated Core failures", async () => {
    getMembershipExperience.mockResolvedValue({
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: "core",
      },
    });
    const response = await GET(new Request("https://freshmarkets.ph/api/membership"));
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
