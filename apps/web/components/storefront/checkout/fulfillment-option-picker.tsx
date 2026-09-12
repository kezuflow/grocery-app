import { CalendarDays, Check, Clock3, Truck } from "lucide-react";
import type { FulfillmentOptionView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";

function money(option: FulfillmentOptionView) {
  return option.feePreview
    ? new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: option.feePreview.currency,
      }).format(option.feePreview.totalMinor / 100)
    : "Fee unavailable";
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
    <fieldset disabled={disabled} className="mt-5 grid gap-3 md:grid-cols-2">
      <legend className="sr-only">Fulfillment option</legend>
      {options.map((option) => (
        <button
          key={option.optionId}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.eligible}
          aria-pressed={selectedOptionId === option.optionId}
          className={cn(
            "group relative flex min-h-28 items-start gap-4 rounded-[var(--fm-radius-surface)] border bg-white p-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
            selectedOptionId === option.optionId
              ? "border-[var(--fm-primary-dark)] bg-[var(--fm-hover)] shadow-[var(--fm-shadow-card)]"
              : "border-[var(--fm-border)] hover:border-[var(--fm-primary-dark)]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full",
              selectedOptionId === option.optionId
                ? "bg-[var(--fm-primary-dark)] text-white"
                : "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
            )}
          >
            {option.mode === "INSTANT" ? (
              <Clock3 className="size-4" />
            ) : (
              <CalendarDays className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-3">
              <strong className="text-sm">
                {option.mode === "INSTANT"
                  ? (option.deliveryPartner?.displayName ?? "Instant delivery")
                  : "Scheduled delivery"}
              </strong>
              <span className="shrink-0 text-sm font-bold">{money(option)}</span>
            </span>
            <small className="mt-1.5 block text-xs leading-5 text-[var(--fm-text-muted)]">
              {option.eligible
                ? option.mode === "SCHEDULED"
                  ? option.deliveryWindow
                    ? `${option.deliveryWindow.name ? `${option.deliveryWindow.name} · ` : ""}${new Date(option.deliveryWindow.startsAt).toLocaleString()} – ${new Date(option.deliveryWindow.endsAt).toLocaleString()}`
                    : "Delivery assigned by store"
                  : option.promisedAt
                    ? `${option.deliveryPartner?.serviceLabel ?? "Instant"} · Expected ${new Date(option.promisedAt).toLocaleString()}`
                    : option.deliveryWindow
                      ? `${new Date(option.deliveryWindow.startsAt).toLocaleDateString()} delivery window`
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
          {selectedOptionId === option.optionId ? (
            <span className="absolute bottom-3 right-3 grid size-5 place-items-center rounded-full bg-[var(--fm-primary-dark)] text-white">
              <Check className="size-3" aria-hidden="true" />
            </span>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}
