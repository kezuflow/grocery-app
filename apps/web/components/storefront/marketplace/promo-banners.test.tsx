import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromoBanners } from "./promo-banners";
describe("Standalone banners", () => {
  it("renders image links without promotion codes or checkout terms", () => {
    const html = renderToStaticMarkup(
      <PromoBanners
        campaigns={[
          {
            bannerId: "b",
            name: "Seasonal collection",
            href: "/#catalog",
            image: { src: "/media/banners/image/1", alt: "Fresh vegetables" },
          },
        ]}
      />,
    );
    expect(html).toContain('src="/media/banners/image/1"');
    expect(html).toContain('href="/#catalog"');
    expect(html).not.toContain("Code:");
    expect(html).not.toContain("checkout");
  });
  it("supports an informational banner without a destination", () => {
    const html = renderToStaticMarkup(
      <PromoBanners
        campaigns={[
          {
            bannerId: "b",
            name: "Announcement",
            href: null,
            image: { src: "/media/banners/image/1", alt: "Announcement" },
          },
        ]}
      />,
    );
    expect(html).not.toMatch(/<a[^>]*href=/);
    expect(html).toContain("Announcement");
  });
  it("omits the gallery when no banner is published", () => {
    expect(renderToStaticMarkup(<PromoBanners campaigns={[]} />)).toBe("");
  });
});
