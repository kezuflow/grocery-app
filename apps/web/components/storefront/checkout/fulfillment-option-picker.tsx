import { CalendarDays, Check, Clock3, Truck } from "lucide-react";
import type { FulfillmentOptionView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";

function money(option: FulfillmentOptionView) {
  return option.feePreview
    ? new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: option.feePreview.currency,
      }).format(option.feePreview.totalMinor / 100)
    : option.eligible
      ? "Calculated on review"
      : "Unavailable";
}
export function FulfillmentOptionPicker({
  options,
  disabled,
  onSelect,
  selectedOptionId,
}: {
  options: readonly FulfillmentOptionView[];
  disabled: boolean;
  onSelect: (option: FulfillmentOptionView) => void;
  selectedOptionId?: string;
}) {
  return (
    <fieldset disabled={disabled} className="mt-4 grid divide-y divide-[var(--fm-border)]">
      <legend className="sr-only">Fulfillment option</legend>
      {options.map((option) => (
        <button
          key={option.optionId}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.eligible}
          aria-pressed={selectedOptionId === option.optionId}
          className={cn(
            "group flex min-h-24 w-full items-start gap-3 bg-transparent px-0 py-4 text-left transition-[color,opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] first:pt-2 last:pb-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fm-primary-dark)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
            selectedOptionId === option.optionId
              ? "text-[var(--fm-primary-dark)]"
              : "text-[var(--fm-text)] hover:text-[var(--fm-primary-dark)]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 grid size-8 shrink-0 place-items-center",
              selectedOptionId === option.optionId
                ? "text-[var(--fm-primary-dark)]"
                : "text-[var(--fm-text-muted)] group-hover:text-[var(--fm-primary-dark)]",
            )}
          >
            {option.mode === "INSTANT" ? (
              <Clock3 className="size-5" />
            ) : (
              <CalendarDays className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-3">
              <strong className="text-sm">
                {option.mode === "INSTANT"
                  ? (option.deliveryPartner?.displayName ?? "Instant delivery")
                  : "Scheduled delivery"}
              </strong>
              <span className="flex shrink-0 items-center gap-2 text-sm font-bold">
                {money(option)}
                {selectedOptionId === option.optionId ? (
                  <span className="grid size-5 place-items-center rounded-full bg-[var(--fm-primary-dark)] text-white">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                ) : null}
              </span>
            </span>
            <small className="mt-1.5 block text-xs leading-5 text-[var(--fm-text-muted)]">
              {option.eligible
                ? option.mode === "SCHEDULED"
                  ? option.deliveryWindow
                    ? `${new Date(option.deliveryWindow.startsAt).toLocaleString()} – ${new Date(option.deliveryWindow.endsAt).toLocaleString()}`
                    : "Delivery assigned by store"
                  : option.promisedAt
                    ? `${option.deliveryPartner?.serviceLabel ?? "Instant"} · Expected ${new Date(option.promisedAt).toLocaleString()}`
                    : option.deliveryWindow
                      ? `${new Date(option.deliveryWindow.startsAt).toLocaleDateString()} delivery range`
                      : "Available"
                : (option.unavailableReason ?? "Unavailable").toLowerCase().replaceAll("_", " ")}
            </small>
            {option.deliveryPartner ? (
              <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--fm-text-muted)]">
                <Truck className="size-3" aria-hidden="true" />
                {option.deliveryPartner.serviceLabel}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </fieldset>
  );
}
