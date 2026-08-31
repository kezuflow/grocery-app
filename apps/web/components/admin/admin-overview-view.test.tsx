import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminOverviewView } from "@freshmarkets/contracts";
import { AdminOverviewViewContent } from "./admin-overview-view";

const overview: AdminOverviewView = {
  generatedAt: "2026-08-31T08:00:00.000Z",
  selectedScope: { kind: "GLOBAL" },
  timezone: "Asia/Manila",
  cards: [
    {
      code: "OPEN_ORDERS",
      label: "Open orders",
      value: 0,
      unavailableReason: null,
      href: "/admin/orders",
    },
    {
      code: "ACTION_REQUIRED_PAYMENTS",
      label: "Payments requiring action",
      value: null,
      unavailableReason: "Global payments.read access is required.",
      href: "/admin/payments",
    },
  ],
  workloadStages: [{ code: "READY", label: "ready", count: 3 }],
  exceptions: [],
  recentOperations: [],
  freshness: { computedAt: "2026-08-31T08:00:00.000Z", sourceWatermark: null },
  deniedSections: ["payments"],
};

describe("AdminOverviewViewContent", () => {
  it("renders authoritative zeroes while preserving unavailable values", () => {
    const html = renderToStaticMarkup(<AdminOverviewViewContent overview={overview} />);
    expect(html).toContain("Open orders");
    expect(html).toContain(">0<");
    expect(html).toContain("Global payments.read access is required.");
    expect(html).toContain("Operational workload");
    expect(html).not.toContain("₱");
  });
});
