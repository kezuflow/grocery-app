import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/payments/transactions" }));
import { PaymentNavigation } from "./payment-navigation";

describe("PaymentNavigation", () => {
  it("uses the settings-tab composition and identifies the active workspace", () => {
    const html = renderToStaticMarkup(<PaymentNavigation />);
    expect(html).toContain('aria-label="Payment administration"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Transactions");
  });
});
