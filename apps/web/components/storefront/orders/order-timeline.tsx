import type { CustomerOrderProgressView } from "@freshmarkets/contracts";
import { Check, CreditCard, PackageCheck, Truck, House, type LucideIcon } from "lucide-react";

const milestones = {
  PAYMENT: { title: "Payment successful", icon: CreditCard },
  PACKED: { title: "Packed", icon: PackageCheck },
  OUT_FOR_DELIVERY: { title: "Out for delivery", icon: Truck },
  DELIVERED: { title: "Delivered", icon: House },
} satisfies Record<
  CustomerOrderProgressView["steps"][number]["key"],
  { title: string; icon: LucideIcon }
>;

export function OrderTimeline({
  progress,
  orientation = "horizontal",
  headingId = "order-timeline-heading",
}: {
  progress: CustomerOrderProgressView;
  orientation?: "horizontal" | "vertical";
  headingId?: string;
}) {
  const vertical = orientation === "vertical";
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-bold">
        Order progress
      </h2>
      <ol aria-label="Order progress" className={vertical ? "mt-5" : "mt-5 grid grid-cols-4"}>
        {progress.steps.map((step, index) => {
          const { title, icon: Icon } = milestones[step.key];
          const complete = step.state === "COMPLETE";
          return (
            <li
              key={step.key}
              data-progress-state={step.state}
              aria-current={step.state === "CURRENT" ? "step" : undefined}
              className={
                vertical
                  ? "relative flex min-w-0 gap-3 pb-6 last:pb-0"
                  : "relative min-w-0 pr-1.5 last:pr-0 sm:pr-4"
              }
            >
              {index < progress.steps.length - 1 ? (
                <span
                  className={
                    vertical
                      ? "absolute bottom-0 left-[15px] top-8 w-0.5 bg-[var(--fm-border)]"
                      : "absolute left-4 right-0 top-[15px] h-0.5 bg-[var(--fm-border)]"
                  }
                  aria-hidden="true"
                >
                  <span
                    className="fm-order-progress-fill absolute inset-0 bg-[var(--fm-storefront-accent)]"
                    data-complete={progress.steps[index + 1]?.state === "COMPLETE"}
                  />
                </span>
              ) : null}
              <span
                data-timeline-marker
                className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-white ${
                  complete
                    ? "border-[var(--fm-storefront-accent)] text-[var(--fm-storefront-accent)]"
                    : step.state === "CURRENT"
                      ? "border-[var(--fm-primary-dark)] text-[var(--fm-primary-dark)]"
                      : "border-[var(--fm-border)] text-[var(--fm-text-muted)]"
                }`}
                aria-hidden="true"
              >
                <span
                  className="fm-order-progress-fill absolute inset-0 rounded-full bg-[var(--fm-storefront-accent)]"
                  data-complete={complete}
                />
                {complete ? (
                  <Check className="relative size-4 text-white" strokeWidth={2.5} />
                ) : (
                  <Icon className="relative size-4" strokeWidth={2} />
                )}
              </span>
              <div className={vertical ? "min-w-0 pt-1" : "mt-3 min-w-0"}>
                <h3
                  className={`break-words font-semibold leading-tight ${vertical ? "text-sm" : "text-[11px] sm:text-sm"} ${
                    complete
                      ? "text-[var(--fm-storefront-accent)]"
                      : step.state === "CURRENT"
                        ? "text-[var(--fm-text)]"
                        : "text-[var(--fm-text-muted)]"
                  }`}
                >
                  {title}
                </h3>
                <span className="sr-only">
                  {complete
                    ? "Completed"
                    : step.state === "CURRENT"
                      ? "In progress"
                      : "Not started"}
                </span>
                {step.achievedAt ? (
                  <time
                    className="mt-1 block break-words text-[10px] leading-tight text-[var(--fm-text-muted)] sm:text-xs"
                    dateTime={step.achievedAt}
                  >
                    {new Date(step.achievedAt).toLocaleString()}
                  </time>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p role="status" className="mt-4 text-sm text-[var(--fm-text-muted)]">
        {progress.detail}
      </p>
    </section>
  );
}
