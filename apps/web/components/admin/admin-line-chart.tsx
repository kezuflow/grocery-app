"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminChartDatum } from "./admin-bar-chart";

export default function AdminLineChart({
  data,
  categoryKey,
  valueKey,
}: {
  data: ReadonlyArray<AdminChartDatum>;
  categoryKey: string;
  valueKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -18, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--fm-border)" />
        <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} fontSize={11} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip cursor={{ stroke: "var(--fm-border)" }} />
        <Line
          connectNulls={false}
          dataKey={valueKey}
          dot={false}
          stroke="var(--fm-admin-accent)"
          strokeWidth={2}
          type="monotone"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
