import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/storefront/storefront-shell", () => ({
  StorefrontShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MembershipExperiencePanel } from "@/app/account/page";

describe("account Membership experience", () => {
  it("renders price, trial, state, and actions from the Core DTO", () => {
    const html = renderToStaticMarkup(
      <MembershipExperiencePanel
        busy={false}
        onAction={() => undefined}
        experience={{
          offer: {
            offerId: "offer",
            priceVersionId: "membership-price-version-1",
            priceVersion: 1,
            code: "MEMBERSHIP_MONTHLY",
            name: "Market Plus",
            amountMinor: 41200,
            currency: "PHP",
            billingInterval: "CALENDAR_MONTH",
          },
          subscription: null,
          introductoryTrial: { eligible: true, status: "AVAILABLE", duration: "CALENDAR_MONTH" },
          recurringAuthorization: { ready: true, status: "READY" },
          actions: {
            startTrial: { available: true, disabledReason: null },
            beginPaidEnrollment: { available: true, disabledReason: null },
            pause: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
            resume: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
            cancelImmediately: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
            cancelAtPeriodEnd: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
          },
        }}
      />,
    );
    expect(html).toContain("Market Plus");
    expect(html).toContain("₱412.00");
    expect(html).toContain("Start introductory trial");
    expect(html).not.toContain("₱299");
  });
});
