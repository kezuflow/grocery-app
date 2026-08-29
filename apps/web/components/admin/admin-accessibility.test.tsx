import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../ui/sheet.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("../ui/table.tsx", import.meta.url), "utf8");

describe("shared Admin accessibility contract", () => {
  it("exposes labelled main content, active navigation, and a focusable mobile menu", () => {
    expect(shell).toMatch(/<main[^>]+aria-labelledby=/);
    expect(shell).toMatch(/aria-current=\{isActive/);
    expect(shell).toMatch(/focus-visible:ring-2/);
    expect(shell).toMatch(/onCloseAutoFocus/);
  });

  it("gives shell states headings and status semantics", () => {
    expect(shell).toMatch(/<h1[^>]*>[\s\S]*Sign in required/);
    expect(shell).toMatch(/<h1[^>]*>[\s\S]*Staff access required/);
    expect(shell).toMatch(/role="status"/);
    expect(shell).toMatch(/aria-live="polite"/);
  });

  it("keeps shared table content keyboard discoverable and headers scoped", () => {
    expect(table).toMatch(/tabIndex=\{0\}/);
    expect(table).toMatch(/aria-label=/);
    expect(table).toMatch(/scope="col"/);
  });

  it("names the mobile dialog close action", () => {
    expect(sheet).toMatch(/aria-label="Close admin navigation"/);
  });
});
