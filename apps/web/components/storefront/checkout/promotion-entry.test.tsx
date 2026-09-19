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

  it("supports a flat checkout presentation without a card surface", () => {
    const html = renderToStaticMarkup(
      <PromotionEntry
        codes={[]}
        feedback={[]}
        disabled={false}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        surface="flat"
      />,
    );

    expect(html).not.toContain("fm-shadow-card");
    expect(html).not.toContain("bg-[var(--fm-surface-soft)]");
  });

  it("supports compact Cart placement with instance-safe labels and pending eligibility copy", () => {
    const html = renderToStaticMarkup(
      <>
        <PromotionEntry
          codes={["SAVE10"]}
          feedback={[]}
          disabled={false}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          surface="compact"
        />
        <PromotionEntry
          codes={[]}
          feedback={[]}
          disabled={false}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          surface="compact"
        />
      </>,
    );
    const inputIds = [...html.matchAll(/id="([^"]+-promotion-code)"/g)].map((match) => match[1]);
    expect(inputIds).toHaveLength(2);
    expect(new Set(inputIds).size).toBe(2);
    expect(html).toContain("Eligibility is checked with your delivery total at checkout.");
    expect(html).toContain("Added; eligibility pending checkout.");
  });
});
