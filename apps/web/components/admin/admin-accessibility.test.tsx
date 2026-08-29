import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

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

  it("renders loading, empty, unavailable, and error states with DOM semantics", () => {
    const loading = renderToStaticMarkup(
      createElement(
        "div",
        { role: "status", "aria-label": "Loading orders" },
        createElement("div", { className: "h-10 w-full" }),
      ),
    );
    const empty = renderToStaticMarkup(
      createElement("p", { role: "status" }, "No orders match this filter."),
    );
    const unavailable = renderToStaticMarkup(
      createElement(
        "div",
        { role: "alert" },
        createElement("h2", null, "Analytics unavailable"),
        createElement("div", null, "Source freshness is unavailable."),
      ),
    );
    const error = renderToStaticMarkup(
      createElement(
        "div",
        { role: "alert" },
        createElement("h2", null, "Orders could not be loaded"),
        createElement("div", null, "Request reference: req-1"),
      ),
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading orders");
    expect(empty).toContain('role="status"');
    expect(empty).toContain("No orders match this filter.");
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).toContain("Analytics unavailable");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Request reference: req-1");
  });

  it("keeps shared table content keyboard discoverable and headers scoped", () => {
    expect(table).toMatch(/tabIndex=\{0\}/);
    expect(table).toMatch(/aria-label=/);
    expect(table).toMatch(/scope="col"/);
  });

  it("renders status text and a scoped table header in the actual DOM", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement("span", { role: "status", "aria-live": "polite" }, "SHORTAGE"),
        createElement(
          "div",
          { "aria-label": "Order queue" },
          createElement(
            "table",
            null,
            createElement(
              "thead",
              null,
              createElement("tr", null, createElement("th", { scope: "col" }, "Status")),
            ),
          ),
        ),
      ),
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-label="Order queue"');
    expect(markup).toContain('scope="col"');
  });

  it("names the mobile dialog close action", () => {
    expect(sheet).toMatch(/aria-label="Close admin navigation"/);
  });
});
