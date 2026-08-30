import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { MembershipCtaBar } from "./membership-cta-bar";

const experience = {
  offer: {
    offerId: "offer",
    code: "MEMBERSHIP_MONTHLY",
    name: "FreshMarkets Membership",
    amountMinor: 41200,
    currency: "PHP",
    billingInterval: "CALENDAR_MONTH" as const,
  },
  subscription: null,
  introductoryTrial: {
    eligible: true,
    status: "AVAILABLE" as const,
    duration: "CALENDAR_MONTH" as const,
  },
  recurringAuthorization: { ready: true, status: "READY" as const },
  actions: {
    startTrial: { available: true, disabledReason: null },
    beginPaidEnrollment: { available: true, disabledReason: null },
    pause: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
    resume: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
    cancelImmediately: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
    cancelAtPeriodEnd: { available: false, disabledReason: "SUBSCRIPTION_REQUIRED" },
  },
};

describe("MembershipCtaBar", () => {
  it("renders a clear membership-trial action with the original produce-box artwork", () => {
    const html = renderToStaticMarkup(<MembershipCtaBar experience={experience} />);

    expect(html).toContain('aria-label="FreshMarkets membership offer"');
    expect(html).toContain("Start the available introductory trial, then ₱412/month.");
    expect(html).toContain('href="/account"');
    expect(html).toContain("Review introductory trial");
    expect(html).toContain('src="/illustrations/produce-box-cta.webp"');
    expect(html).toContain('aria-label="Dismiss membership offer"');
  });

  it("anchors the dismiss button to the full sticky bar instead of the centered content", () => {
    const html = renderToStaticMarkup(<MembershipCtaBar experience={experience} />);

    expect(html).toMatch(/<\/div><button[^>]+aria-label="Dismiss membership offer"/);
    expect(html).toMatch(/aria-label="Dismiss membership offer"[^>]+top-1\/2/);
  });
});
