import { describe, expect, it } from "vitest";
import { renderEmail } from "./email-templates";
describe("notification email templates", () => {
  it.each(["STAFF_INVITED", "CUSTOMER_INVITED"] as const)(
    "uses only the configured origin for %s",
    (type) => {
      const rendered = renderEmail(
        type,
        { expiresAt: 1_800_000_000_000, url: "https://untrusted.example/token" },
        "https://freshmarkets.example/ignored",
      );
      expect(rendered.text).toContain("https://freshmarkets.example/");
      expect(rendered.text).not.toContain("untrusted");
      expect(rendered.text).not.toContain("ignored");
      expect(rendered.text).toContain("verify your email");
    },
  );
  it.each([undefined, "javascript:alert(1)", "http://public.example"])(
    "rejects an unavailable or unsafe invitation origin %s",
    (origin) => {
      expect(() =>
        renderEmail("CUSTOMER_INVITED", { expiresAt: 1_800_000_000_000 }, origin),
      ).toThrow();
    },
  );
  it("escapes customer-controlled references and remains deterministic", () => {
    const rendered = renderEmail("ORDER_CONFIRMED", { orderNumber: "<script>alert(1)</script>" });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.templateVersion).toBe(1);
  });
  it("renders customer-safe cancellation progress without internal evidence", () => {
    const rendered = renderEmail("ORDER_REFUND_PROGRESSING", {
      orderNumber: "FM-1",
      amountMinor: 97_500,
      currency: "PHP",
    });
    expect(rendered.subject).toContain("refund is processing");
    expect(rendered.text).toContain("PHP 975.00");
    expect(rendered.text).not.toMatch(/provider|staff|routing/i);
  });
});
