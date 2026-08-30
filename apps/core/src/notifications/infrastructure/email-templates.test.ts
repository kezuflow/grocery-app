import { describe, expect, it } from "vitest";
import { renderEmail } from "./email-templates";
describe("notification email templates", () => {
  it("escapes customer-controlled references and remains deterministic", () => {
    const rendered = renderEmail("ORDER_CONFIRMED", { orderNumber: "<script>alert(1)</script>" });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.templateVersion).toBe(1);
  });
});
