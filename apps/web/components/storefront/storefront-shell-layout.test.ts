import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(new URL("./storefront-shell.tsx", import.meta.url), "utf8");

describe("StorefrontShell layout", () => {
  it("places the footer below the complete desktop navigation and content row", () => {
    expect(shell).toMatch(
      /<div className="flex min-h-\[calc\(100dvh-4rem\)\] w-full items-start">\s*<StorefrontSidebar \/>\s*<main[^>]*>\{children\}<\/main>\s*<\/div>\s*<StorefrontFooter \/>/,
    );
  });
});
