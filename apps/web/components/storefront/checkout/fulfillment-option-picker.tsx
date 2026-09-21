import { Check } from "lucide-react";
import type { FulfillmentOptionView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";
import { DeliveryPartnerIcon } from "./delivery-partner-icon";

type QuotedFee = Readonly<{
  optionId: string;
  amountMinor: number;
  currency: string;
}>;

function formattedMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function refreshCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function money(option: FulfillmentOptionView, quotedFee?: QuotedFee, loadingOptionId?: string) {
  if (quotedFee?.optionId === option.optionId)
    return formattedMoney(quotedFee.amountMinor, quotedFee.currency);
  if (loadingOptionId === option.optionId) return "Checking fee…";
  return option.feePreview
    ? formattedMoney(option.feePreview.totalMinor, option.feePreview.currency)
    : option.eligible
      ? "Select to calculate"
      : "Unavailable";
}

const scheduleFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function scheduleDetails(option: FulfillmentOptionView) {
  if (option.mode === "INSTANT")
    return option.promisedAt
      ? `${option.deliveryPartner?.serviceLabel ?? "Instant"} · Expected ${new Date(option.promisedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`
      : (option.deliveryPartner?.serviceLabel ?? "Available");
  if (!option.deliveryWindow) return "Scheduled delivery";
  return `${option.deliveryPartner?.serviceLabel ?? "Scheduled"} · ${scheduleFormatter.format(new Date(option.deliveryWindow.startsAt))}–${scheduleFormatter.format(new Date(option.deliveryWindow.endsAt))}`;
}

export function FulfillmentOptionPicker({
  options,
  disabled,
  onSelect,
  selectedOptionId,
  quotedFee,
  loadingOptionId,
  quoteRefreshRemainingSeconds,
}: {
  options: readonly FulfillmentOptionView[];
  disabled: boolean;
  onSelect: (option: FulfillmentOptionView) => void;
  selectedOptionId?: string;
  quotedFee?: QuotedFee;
  loadingOptionId?: string;
  quoteRefreshRemainingSeconds?: number | null;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="mt-3 grid divide-y divide-[var(--fm-border)]"
      role="radiogroup"
      aria-label="Delivery option"
    >
      <legend className="sr-only">Delivery option</legend>
      {options.map((option) => (
        <button
          key={option.optionId}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.eligible}
          role="radio"
          aria-checked={selectedOptionId === option.optionId}
          className={cn(
            "group flex min-h-20 w-full items-center gap-3 bg-transparent px-0 py-3 text-left transition-[color,opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] first:pt-2 last:pb-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fm-primary-dark)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
            selectedOptionId === option.optionId
              ? "text-[var(--fm-primary-dark)]"
              : "text-[var(--fm-text)] hover:text-[var(--fm-primary-dark)]",
          )}
        >
          <DeliveryPartnerIcon code={option.deliveryPartner?.code} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-3">
              <strong className="text-sm leading-5">
                {option.deliveryPartner?.displayName ??
                  (option.mode === "SCHEDULED" ? "Scheduled delivery" : "Instant delivery")}
              </strong>
              <span className="flex min-w-[8.5rem] shrink-0 flex-col items-end text-sm font-bold tabular-nums">
                <span className="flex items-center justify-end gap-2">
                  {money(option, quotedFee, loadingOptionId)}
                  {selectedOptionId === option.optionId ? (
                    <span className="grid size-5 place-items-center rounded-full bg-[var(--fm-primary-dark)] text-white">
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                  ) : null}
                </span>
                {quotedFee?.optionId === option.optionId &&
                selectedOptionId === option.optionId &&
                quoteRefreshRemainingSeconds != null ? (
                  <small
                    role="timer"
                    className="mt-0.5 text-[0.6875rem] font-medium text-[var(--fm-text-muted)]"
                  >
                    Fee refresh in {refreshCountdown(quoteRefreshRemainingSeconds)}
                  </small>
                ) : null}
              </span>
            </span>
            <small className="mt-0.5 block text-xs leading-5 text-[var(--fm-text-muted)]">
              {option.eligible
                ? scheduleDetails(option)
                : (option.unavailableReason ?? "Unavailable").toLowerCase().replaceAll("_", " ")}
            </small>
            {option.mode === "SCHEDULED" && option.cutoffAt ? (
              <small className="mt-0.5 block text-xs leading-5 text-[var(--fm-text-muted)]">
                Order cutoff {scheduleFormatter.format(new Date(option.cutoffAt))}
              </small>
            ) : null}
          </span>
        </button>
      ))}
    </fieldset>
  );
}
