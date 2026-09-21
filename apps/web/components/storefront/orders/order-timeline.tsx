import type { CustomerTimelineEntry } from "@freshmarkets/contracts";

export function OrderTimeline({ entries }: { entries: readonly CustomerTimelineEntry[] }) {
  const currentEntry = entries[entries.length - 1];

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
        <>
          <ol
            aria-label="Order progress"
            className="-mx-1 mt-5 flex snap-x snap-mandatory overflow-x-auto px-1 pb-2 pt-1"
          >
            {entries.map((entry, index) => {
              const paymentSucceeded =
                entry.type === "PAYMENT_STATUS" && entry.status === "SUCCEEDED";

              return (
                <li
                  key={entry.eventId}
                  className="relative min-w-48 flex-1 snap-start pr-5 last:pr-0"
                >
                  {index < entries.length - 1 ? (
                    <span
                      className="absolute left-3 right-0 top-[9px] h-0.5 bg-[var(--fm-border)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={`relative z-10 block size-3 rounded-full border-2 border-white ring-1 ${
                      paymentSucceeded
                        ? "bg-[var(--fm-success)] ring-[var(--fm-success)]"
                        : "bg-[var(--fm-primary-dark)] ring-[var(--fm-primary-dark)]"
                    }`}
                    data-timeline-marker
                    aria-hidden="true"
                  />
                  <div className="mt-3">
                    <h3
                      className={`font-semibold leading-tight ${
                        paymentSucceeded ? "text-[var(--fm-success)]" : ""
                      }`}
                    >
                      {entry.title}
                    </h3>
                    <time
                      className="mt-1 block text-xs text-[var(--fm-text-muted)]"
                      dateTime={entry.occurredAt}
                    >
                      {new Date(entry.occurredAt).toLocaleString()}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
          <p role="status" className="mt-3 text-sm text-[var(--fm-text-muted)]">
            {currentEntry?.description}
          </p>
        </>
      )}
    </section>
  );
}
