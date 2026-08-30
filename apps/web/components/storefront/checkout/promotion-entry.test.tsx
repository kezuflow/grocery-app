import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PromotionEntry } from "./promotion-entry";

describe("PromotionEntry", () => {
  it("provides labelled keyboard controls, active codes, and live feedback", () => {
    const html = renderToStaticMarkup(
      <PromotionEntry
        codes={["SAVE10"]}
        feedback={[{ code: "SAVE10", status: "APPLIED", message: "Promotion applied" }]}
        disabled={false}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Promotion code"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("SAVE10");
    expect(html).toContain('aria-label="Remove SAVE10 promotion code"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Promotion applied");
  });

  it("explicitly reports when a submitted code produced no discount", () => {
    const html = renderToStaticMarkup(
      <PromotionEntry
        codes={["ZERO"]}
        feedback={[{ code: "ZERO", status: "NOT_SELECTED", message: "No discount applied" }]}
        disabled={false}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("No discount applied");
  });
});
