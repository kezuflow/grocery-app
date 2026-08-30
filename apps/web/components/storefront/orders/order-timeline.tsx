import type { CustomerTimelineEntry } from "@freshmarkets/contracts";

export function OrderTimeline({ entries }: { entries: readonly CustomerTimelineEntry[] }) {
  return (
    <section aria-labelledby="order-timeline-heading">
      <h2 id="order-timeline-heading" className="text-xl font-bold">
        Order timeline
      </h2>
      {entries.length === 0 ? (
        <p
          role="status"
          className="mt-3 rounded-lg bg-[var(--fm-surface-soft)] p-4 text-sm text-[var(--fm-text-muted)]"
        >
          Timeline updates are not available for this historical order.
        </p>
      ) : (
        <ol className="mt-4 space-y-4 border-l-2 border-[var(--fm-border)] pl-5">
          {entries.map((entry) => (
            <li key={entry.eventId} className="relative">
              <span
                className="absolute -left-[1.65rem] top-1.5 size-3 rounded-full border-2 border-white bg-[var(--fm-primary-dark)]"
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{entry.title}</h3>
                <time className="text-xs text-[var(--fm-text-muted)]" dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">{entry.description}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
