"use client";

import type { MetricSeriesView } from "@freshmarkets/contracts";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminChartCard, AdminDashboardGrid } from "./admin-compositions";

export function AnalyticsChartGrid({ series }: { series: ReadonlyArray<MetricSeriesView> }) {
  if (series.length === 0) return null;
  return (
    <AdminDashboardGrid ariaLabel="Versioned metric trends">
      {series.map((metric) => {
        const data = metric.points.map((point) => ({
          occurredAt: point.occurredAt.slice(0, 10),
          value: point.value,
        }));
        return (
          <AdminChartCard
            className="md:col-span-1 xl:col-span-6"
            key={`${metric.metricCode}:${metric.definitionVersion}`}
            title={metric.metricCode}
            description={`Definition v${metric.definitionVersion} · ${metric.window.timezone}`}
            summary={data.map(
              (point) =>
                `${point.occurredAt}: ${point.value === null ? "Unavailable" : point.value}`,
            )}
          >
            {metric.availability === "AVAILABLE" && data.length > 0 ? (
              <div className="h-64 pt-4" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--fm-border)" />
                    <XAxis dataKey="occurredAt" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip cursor={{ stroke: "var(--fm-border)" }} />
                    <Line
                      connectNulls={false}
                      dataKey="value"
                      dot={false}
                      stroke="var(--fm-admin-accent)"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-8 text-sm text-[var(--fm-text-muted)]">
                {metric.unavailableReason ??
                  "No authoritative points are available for this window."}
              </p>
            )}
          </AdminChartCard>
        );
      })}
    </AdminDashboardGrid>
  );
}
