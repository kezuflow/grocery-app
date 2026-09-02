import { describe, expectTypeOf, it } from "vitest";
import type { MembershipExperienceView } from "./membership";

describe("MembershipExperienceView", () => {
  it("keeps provider facts outside the customer membership boundary", () => {
    expectTypeOf<MembershipExperienceView>().toMatchTypeOf<{
      offer: { amountMinor: number; currency: string; billingInterval: "CALENDAR_MONTH" };
      recurringAuthorization: { ready: boolean; status: "READY" | "PENDING" | "REQUIRED" };
      actions: { cancelImmediately: { available: boolean; disabledReason: string | null } };
    }>();
    expectTypeOf<keyof MembershipExperienceView>().not.toEqualTypeOf<"provider">();
  });
});
