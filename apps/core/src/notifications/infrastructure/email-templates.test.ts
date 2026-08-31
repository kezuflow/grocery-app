import { describe, expect, it } from "vitest";
import { renderEmail } from "./email-templates";
describe("notification email templates", () => {
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
