import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/commerce-configuration" }));
import { CommerceConfigurationView } from "./commerce-configuration-view";

const membership = {
  priceVersionId: "price-v7",
  offerId: "membership-global",
  amountMinor: 29_900,
  currency: "PHP",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: null,
  version: 7,
};

describe("CommerceConfigurationView", () => {
  it("renders membership pricing without a customer service-fee surface", () => {
    const html = renderToStaticMarkup(
      <CommerceConfigurationView
        canManageMembership
        membership={membership}
        onMembershipSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("Membership price");
    expect(html).toContain("Version 7");
    expect(html).toContain("price-v7");
    expect(html).toContain("Existing paid subscriptions retain their snapshotted price");
    expect(html).toContain("Replacement effective from");
    expect(html).not.toContain("Service Fee");
  });

  it("keeps membership pricing read-only without manage permission", () => {
    const html = renderToStaticMarkup(
      <CommerceConfigurationView
        canManageMembership={false}
        membership={membership}
        onMembershipSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("Membership management permission is required");
    expect(html).not.toContain("Create replacement version");
  });
});
