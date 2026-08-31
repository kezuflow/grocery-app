import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/commerce-configuration" }));
import { CommerceConfigurationView } from "./commerce-configuration-view";

describe("CommerceConfigurationView", () => {
  it("renders exact current configuration and replacement-only controls", () => {
    const html = renderToStaticMarkup(
      <CommerceConfigurationView
        activeTab="membership"
        canManageMembership
        canManageServiceFee
        membership={{
          priceVersionId: "price-v7",
          offerId: "membership-global",
          amountMinor: 29_900,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 7,
        }}
        serviceFee={{
          configurationId: "fee-v4",
          feeType: "MIXED",
          flatMinor: 1_500,
          percentageBasisPoints: 250,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 4,
          reason: "Approved fee review",
        }}
        onMembershipSubmit={vi.fn()}
        onServiceFeeSubmit={vi.fn()}
      />,
    );

    expect(html).toContain("Membership Price");
    expect(html).toContain("Version 7");
    expect(html).toContain("price-v7");
    expect(html).toContain("Existing subscriptions retain their snapshotted price");
    expect(html).toContain("Replacement effective from");
    expect(html).toContain("Reason for change");
    expect(html).toContain("I confirm this creates a new effective-dated version");
    expect(html).toContain("immutable audit event");
    expect(html).not.toContain("Edit history");
  });

  it("keeps a readable configuration read-only without the manage capability", () => {
    const html = renderToStaticMarkup(
      <CommerceConfigurationView
        activeTab="service-fee"
        canManageMembership={false}
        canManageServiceFee={false}
        membership={null}
        serviceFee={{
          configurationId: "fee-v4",
          feeType: "FLAT",
          flatMinor: 1_500,
          percentageBasisPoints: 0,
          currency: "PHP",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
          version: 4,
          reason: "Approved fee review",
        }}
        onMembershipSubmit={vi.fn()}
        onServiceFeeSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("Read-only access");
    expect(html).toContain("Instant orders only");
    expect(html).not.toContain("Replace Service Fee");
  });
});
