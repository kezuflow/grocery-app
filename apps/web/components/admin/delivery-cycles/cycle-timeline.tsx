import type { CycleCalendarElementKind } from "./cycle-calendar-adapter";

export type CycleTimelineItem = {
  label: string;
  value: string | null;
  endValue?: string | null;
  kind: CycleCalendarElementKind;
};

export function CycleTimeline({
  items,
  timezone,
}: {
  items: readonly CycleTimelineItem[];
  timezone: string;
}) {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return (
    <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[0.3125rem] before:top-4 before:w-px before:bg-[var(--fm-border)]">
      {items.map((item) => (
        <li key={item.label} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 py-2">
          <span
            aria-hidden
            className={`fm-cycle-timeline-dot fm-cycle-timeline-dot-${item.kind} relative z-10 mt-1 size-2.5 rounded-full ring-2 ring-[var(--fm-admin-surface)]`}
          />
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">{item.label}</span>
            <time className="text-xs tabular-nums text-[var(--fm-text-muted)]">
              {item.value
                ? `${formatter.format(new Date(item.value))}${item.endValue ? `–${timeFormatter.format(new Date(item.endValue))}` : ""}`
                : "Not configured"}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
