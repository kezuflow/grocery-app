import type { ReactNode } from "react";

export type AdminChartTooltipPayloadItem = {
  name?: string;
  value?: number | string;
  color?: string;
};

/**
 * Shared Recharts tooltip content styled with admin tokens, so chart
 * readouts match the workspace instead of Recharts' browser defaults.
 */
export function AdminChartTooltipContent({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: ReadonlyArray<AdminChartTooltipPayloadItem>;
  label?: ReactNode;
  formatValue?: (value: number | string) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm">
      {label != null && label !== "" ? (
        <p className="font-medium text-foreground">{label}</p>
      ) : null}
      <p className="mt-0.5 text-muted-foreground">
        {first.name ? `${first.name}: ` : ""}
        {first.value == null ? "—" : formatValue ? formatValue(first.value) : String(first.value)}
      </p>
    </div>
  );
}
