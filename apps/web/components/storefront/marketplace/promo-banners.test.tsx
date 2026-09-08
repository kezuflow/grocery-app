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

import { PromoBanners } from "./promo-banners";

describe("PromoBanners", () => {
  it("renders Core campaign images and structured terms without promising eligibility", () => {
    const html = renderToStaticMarkup(
      <PromoBanners
        campaigns={[
          {
            promotionId: "p",
            code: "FRESH",
            name: "Fresh campaign",
            description: "Fresh savings",
            benefitType: "ORDER_FIXED_DISCOUNT",
            discountMinor: 500,
            percent: null,
            minimumMinor: 0,
            maximumDiscountMinor: null,
            endsAt: null,
            image: { src: "/media/promotions/image/1", alt: "Fresh vegetables" },
          },
        ]}
      />,
    );
    expect(html).toContain('src="/media/promotions/image/1"');
    expect(html).toContain("Fresh campaign");
    expect(html).toContain("FRESH");
    expect(html).toContain("checked at checkout");
    expect(html).not.toContain("membership");
  });
  it("omits the rail when no campaign is published", () => {
    expect(renderToStaticMarkup(<PromoBanners campaigns={[]} />)).toBe("");
  });
});
