import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AdminChartCard,
  AdminDashboardGrid,
  CommandBanner,
  DetailWorkspace,
  EditorLayout,
  MetricCard,
  SettingsTabs,
  StepIndicator,
} from "./admin-compositions";

describe("shared Admin compositions", () => {
  it("renders operational metrics without inventing unavailable values", () => {
    const markup = renderToStaticMarkup(
      createElement(AdminDashboardGrid, {
        ariaLabel: "Operational briefing",
        children: [
          createElement(MetricCard, {
            key: "orders",
            label: "Orders awaiting fulfillment",
            value: "12",
            href: "/admin/orders?status=FULFILLMENT_PENDING",
            freshness: "Generated 10:30",
          }),
          createElement(MetricCard, {
            key: "gmv",
            label: "Gross merchandise value",
            value: null,
            unavailableReason: "Accounting definition is not approved.",
          }),
        ],
      }),
    );

    expect(markup).toContain('aria-label="Operational briefing"');
    expect(markup).toContain("Orders awaiting fulfillment");
    expect(markup).toContain(">12<");
    expect(markup).toContain("Accounting definition is not approved.");
    expect(markup).not.toContain(">0<");
  });

  it("gives charts a non-visual authoritative summary", () => {
    const markup = renderToStaticMarkup(
      createElement(AdminChartCard, {
        title: "Fulfillment workload",
        description: "Current authorized scope",
        summary: ["Picking: 8", "Packing: 4"],
        children: createElement("div", { "aria-hidden": "true" }, "chart"),
      }),
    );

    expect(markup).toContain('role="figure"');
    expect(markup).toContain('aria-label="Fulfillment workload"');
    expect(markup).toContain("Picking: 8");
    expect(markup).toContain("Packing: 4");
  });

  it("renders editor, detail, settings, step, and command-state semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(EditorLayout, {
          editor: createElement("form", null, "Product fields"),
          aside: createElement("div", null, "Readiness"),
          asideLabel: "Product readiness",
        }),
        createElement(DetailWorkspace, {
          summary: createElement("div", null, "Order summary"),
          content: createElement("div", null, "Timeline"),
          actions: createElement("button", null, "Cancel order"),
        }),
        createElement(SettingsTabs, {
          label: "Commerce configuration",
          activeId: "membership",
          tabs: [
            { id: "membership", label: "Membership price", href: "?tab=membership" },
            { id: "fee", label: "Instant service fee", href: "?tab=fee" },
          ],
        }),
        createElement(StepIndicator, {
          currentStep: 2,
          steps: ["Details", "Review", "Confirm"],
        }),
        createElement(CommandBanner, {
          tone: "conflict",
          title: "Configuration changed",
          message: "Refresh before retrying.",
        }),
      ),
    );

    expect(markup).toContain('aria-label="Product readiness"');
    expect(markup).toContain('aria-label="Resource actions"');
    expect(markup).toContain('aria-label="Commerce configuration"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Refresh before retrying.");
  });
});
