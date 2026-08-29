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
  it("renders the five image-based daily deal cards in a horizontal carousel", () => {
    const html = renderToStaticMarkup(<PromoBanners />);

    expect(html).toContain("Daily deals");
    expect(html.match(/<img/g)).toHaveLength(5);
    expect(html).toContain('src="/promos/fresh-this-week.png"');
    expect(html).toContain('src="/promos/tropical-fruit-favorites.png"');
    expect(html).toContain('src="/promos/leafy-greens-for-dinner.png"');
    expect(html).toContain('src="/promos/native-cebu-market-picks.png"');
    expect(html).toContain('src="/promos/membership-made-simple.png"');
    expect(html).toContain('data-testid="daily-deals-gallery"');
    expect(html).toContain('aria-label="Previous deal"');
    expect(html).toContain('aria-label="Next deal"');
    expect(html).toContain("fm-scrollbar-none");
  });
});
