import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MetricSeriesView } from "@freshmarkets/contracts";
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/analytics" }));
import { AnalyticsChartGrid } from "./analytics-chart-grid";

describe("AnalyticsChartGrid", () => {
  it("renders only authoritative series values and preserves unavailable points", () => {
    const series: MetricSeriesView = {
      metricCode: "orders.committed.count",
      definitionVersion: 2,
      window: {
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-08-31T00:00:00.000Z",
        timezone: "Asia/Manila",
      },
      dimensions: [],
      availability: "AVAILABLE",
      unavailableReason: null,
      freshness: {
        computedAt: "2026-08-31T00:00:00.000Z",
        sourceWatermark: "2026-08-30T23:59:00.000Z",
      },
      points: [
        { occurredAt: "2026-08-01T00:00:00.000Z", value: 4 },
        { occurredAt: "2026-08-02T00:00:00.000Z", value: null },
      ],
    };
    const html = renderToStaticMarkup(<AnalyticsChartGrid series={[series]} />);
    expect(html).toContain("orders.committed.count");
    expect(html).toContain("2026-08-01: 4");
    expect(html).toContain("2026-08-02: Unavailable");
    expect(html).not.toContain("2026-08-02: 0");
  });
});
