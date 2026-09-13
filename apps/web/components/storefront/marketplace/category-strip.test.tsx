import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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

import { CategoryStrip } from "./category-strip";

describe("CategoryStrip", () => {
  it("defers pointer capture until movement establishes a drag", () => {
    const source = readFileSync(new URL("./category-strip.tsx", import.meta.url), "utf8");
    const pointerDown = source.match(
      /onPointerDown=\{\(event\) => \{([\s\S]*?)\n        \}\}/,
    )?.[1];
    const pointerMove = source.match(
      /onPointerMove=\{\(event\) => \{([\s\S]*?)\n        \}\}/,
    )?.[1];

    expect(pointerDown).toBeDefined();
    expect(pointerDown).not.toContain("setPointerCapture");
    expect(pointerMove).toContain("if (Math.abs(distance) <= 6) return");
    expect(pointerMove).toContain("setPointerCapture");
  });

  it("renders database-backed categories with their configured SVGs and fallback", () => {
    const html = renderToStaticMarkup(
      <CategoryStrip
        activeCategory="fruits"
        categories={[
          {
            code: "FRUITS",
            name: "Fruits",
            slug: "fruits",
            iconSrc: "/category-icons/fruits.svg",
          },
          {
            code: "NEW_CATEGORY",
            name: "New Category",
            slug: "new-category",
            iconSrc: null,
          },
        ]}
      />,
    );

    expect(html).toContain('href="/?category=fruits"');
    expect(html).toContain('href="/?category=fruits" aria-current="page"');
    expect(html).toContain('src="/category-icons/fruits.svg" alt=""');
    expect(html).toContain("New Category");
    expect(html).toContain('src="/category-icons/all-groceries.svg"');
    expect(html).not.toContain("Meat &amp; Seafood");
  });
});
