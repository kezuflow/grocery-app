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

describe("MembershipCtaBar", () => {
  it("renders a clear membership-trial action with the original produce-box artwork", () => {
    const html = renderToStaticMarkup(<MembershipCtaBar />);

    expect(html).toContain('aria-label="FreshMarkets membership offer"');
    expect(html).toContain("Get FreshMarkets membership");
    expect(html).toContain("for one month, then ₱299/month.");
    expect(html).toContain('href="/account"');
    expect(html).toContain("Start your free trial");
    expect(html).toContain('src="/illustrations/produce-box-cta.webp"');
    expect(html).toContain('aria-label="Dismiss membership offer"');
  });

  it("anchors the dismiss button to the full sticky bar instead of the centered content", () => {
    const html = renderToStaticMarkup(<MembershipCtaBar />);

    expect(html).toMatch(/<\/div><button[^>]+aria-label="Dismiss membership offer"/);
    expect(html).toMatch(/aria-label="Dismiss membership offer"[^>]+top-1\/2/);
  });
});
