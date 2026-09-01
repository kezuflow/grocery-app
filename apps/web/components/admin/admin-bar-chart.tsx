"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type AdminChartDatum = Readonly<Record<string, string | number | null>>;

export default function AdminBarChart({
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
      <BarChart data={data} margin={{ left: -18, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--fm-border)" />
        <XAxis dataKey={categoryKey} tickLine={false} axisLine={false} fontSize={11} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip cursor={{ fill: "var(--fm-surface-muted)" }} />
        <Bar dataKey={valueKey} fill="var(--fm-admin-accent)" radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
