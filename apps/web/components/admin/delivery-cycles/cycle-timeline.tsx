import { Circle } from "lucide-react";

export type CycleTimelineItem = { label: string; value: string | null };

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
  return (
    <ol className="relative space-y-0 before:absolute before:bottom-4 before:left-[0.3125rem] before:top-4 before:w-px before:bg-[var(--fm-border)]">
      {items.map((item) => (
        <li key={item.label} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 py-2">
          <Circle
            aria-hidden
            className="relative z-10 mt-1 size-2.5 fill-[var(--fm-admin-surface)] text-[var(--fm-text-muted)]"
          />
          <div className="grid gap-0.5 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-4">
            <time className="text-sm tabular-nums text-[var(--fm-text-muted)]">
              {item.value ? formatter.format(new Date(item.value)) : "Not configured"}
            </time>
            <span className="text-sm font-medium">{item.label}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
