import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSubscriptionEligibility } = vi.hoisted(() => ({
  getSubscriptionEligibility: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    CORE: {
      getSubscriptionEligibility,
    },
  },
}));

import { GET } from "./route";

beforeEach(() => {
  getSubscriptionEligibility.mockReset();
});

describe("membership account surface", () => {
  it("exposes the PHP 299 calendar-month offer without vendor vocabulary", async () => {
    getSubscriptionEligibility.mockResolvedValue({
      ok: true,
      value: { eligible: true, state: "TRIALING", trialEndsAt: "2026-09-25T00:00:00.000Z" },
    });
    const response = await GET(
      new Request("https://freshmarkets.ph/api/membership", { headers: { cookie: "s=1" } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      value: {
        offer: { amountMinor: number; currency: string; billingInterval: string };
        introductoryTrial: { duration: string };
        cancellationOptions: string[];
        subscriptionState: string | null;
      };
    };
    expect(body.value.offer).toMatchObject({
      amountMinor: 29900,
      currency: "PHP",
      billingInterval: "CALENDAR_MONTH",
    });
    expect(body.value.introductoryTrial).toEqual({
      benefitCode: "INTRO_TRIAL",
      duration: "CALENDAR_MONTH",
    });
    // Both explicit choices are presented; no default is preselected here.
    expect(body.value.cancellationOptions).toEqual(["IMMEDIATE", "PERIOD_END"]);
    expect(body.value.subscriptionState).toBe("TRIALING");
    const serialized = JSON.stringify(body);
    for (const banned of ["provider", "vendor", "trial_days", "14day", "14 day"]) {
      expect(serialized.toLowerCase()).not.toContain(banned);
    }
  });

  it("degrades to a null state when the session is unauthenticated", async () => {
    getSubscriptionEligibility.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication is required" },
    });
    const response = await GET(new Request("https://freshmarkets.ph/api/membership"));
    const body = (await response.json()) as { value: { subscriptionState: string | null } };
    expect(body.value.subscriptionState).toBeNull();
  });
});
