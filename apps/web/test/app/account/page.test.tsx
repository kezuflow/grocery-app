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

import AccountPage from "@/app/account/page";

describe("account", () => {
  it("keeps customer account links without enrollment or recurring billing", () => {
    const html = renderToStaticMarkup(<AccountPage />);
    expect(html).toContain("Your account");
    expect(html).toContain("Delivery addresses");
    expect(html).toContain("Order history");
    expect(html).not.toMatch(/membership|trial|enroll/i);
  });
});
