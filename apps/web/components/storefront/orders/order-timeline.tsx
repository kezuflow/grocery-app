import type { CustomerTimelineEntry } from "@freshmarkets/contracts";
import {
  ClipboardCheck,
  CreditCard,
  MessageCircleWarning,
  PackageCheck,
  RotateCcw,
  ShoppingBasket,
  Truck,
  type LucideIcon,
} from "lucide-react";

const timelineIcons: Record<CustomerTimelineEntry["type"], LucideIcon> = {
  PAYMENT_STATUS: CreditCard,
  ORDER_COMMITTED: ClipboardCheck,
  FULFILLMENT_STATUS: PackageCheck,
  DELIVERY_STATUS: Truck,
  AMENDMENT_STATUS: ShoppingBasket,
  REFUND_STATUS: RotateCcw,
  ISSUE_STATUS: MessageCircleWarning,
};

const progressOrder: Record<CustomerTimelineEntry["type"], number> = {
  PAYMENT_STATUS: 0,
  ORDER_COMMITTED: 1,
  FULFILLMENT_STATUS: 2,
  DELIVERY_STATUS: 3,
  AMENDMENT_STATUS: 4,
  REFUND_STATUS: 5,
  ISSUE_STATUS: 6,
};

function orderForProgress(entries: readonly CustomerTimelineEntry[]) {
  return entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .sort(
      (left, right) =>
        progressOrder[left.entry.type] - progressOrder[right.entry.type] ||
        Date.parse(left.entry.occurredAt) - Date.parse(right.entry.occurredAt) ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ entry }) => entry);
}

export function OrderTimeline({ entries }: { entries: readonly CustomerTimelineEntry[] }) {
  const progressEntries = orderForProgress(entries);
  const currentEntry = entries.reduce<CustomerTimelineEntry | undefined>(
    (latest, entry) =>
      !latest || Date.parse(entry.occurredAt) > Date.parse(latest.occurredAt) ? entry : latest,
    undefined,
  );

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
          <ol aria-label="Order progress" className="mt-5 grid auto-cols-fr grid-flow-col">
            {progressEntries.map((entry, index) => {
              const paymentSucceeded =
                entry.type === "PAYMENT_STATUS" && entry.status === "SUCCEEDED";
              const Icon = timelineIcons[entry.type];

              return (
                <li key={entry.eventId} className="relative min-w-0 pr-2 sm:pr-4 last:pr-0">
                  {index < progressEntries.length - 1 ? (
                    <span
                      className="absolute left-4 right-0 top-[15px] h-0.5 bg-[var(--fm-border)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-white text-white ring-1 ${
                      paymentSucceeded
                        ? "bg-[var(--fm-storefront-accent)] ring-[var(--fm-storefront-accent)]"
                        : "bg-[var(--fm-primary-dark)] ring-[var(--fm-primary-dark)]"
                    }`}
                    data-timeline-marker
                    aria-hidden="true"
                  >
                    <Icon className="size-4" strokeWidth={2.25} />
                  </span>
                  <div className="mt-3">
                    <h3
                      className={`text-sm font-semibold leading-tight break-words sm:text-base ${
                        paymentSucceeded ? "text-[var(--fm-storefront-accent)]" : ""
                      }`}
                    >
                      {entry.title}
                    </h3>
                    <time
                      className="mt-1 block text-[11px] leading-tight text-[var(--fm-text-muted)] sm:text-xs"
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
