import type { FulfillmentOptionView } from "@freshmarkets/contracts";

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
}: {
  options: readonly FulfillmentOptionView[];
  disabled: boolean;
  onSelect: (option: FulfillmentOptionView) => void;
}) {
  return (
    <fieldset disabled={disabled} className="mt-5 grid gap-3">
      <legend className="sr-only">Fulfillment option</legend>
      {options.map((option) => (
        <button
          key={option.optionId}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.eligible}
          className="flex min-h-16 items-center justify-between gap-4 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] p-4 text-left disabled:opacity-50"
        >
          <span>
            <strong>{option.mode === "INSTANT" ? "Instant delivery" : "Scheduled delivery"}</strong>
            <small className="mt-1 block text-xs text-[var(--fm-text-muted)]">
              {option.eligible
                ? option.promisedAt
                  ? `Expected ${new Date(option.promisedAt).toLocaleString()}`
                  : option.deliveryWindow
                    ? `${new Date(option.deliveryWindow.startsAt).toLocaleDateString()} delivery window`
                    : "Available"
                : (option.unavailableReason ?? "Unavailable").toLowerCase().replaceAll("_", " ")}
            </small>
          </span>
          <span className="text-sm font-bold">{money(option)}</span>
        </button>
      ))}
    </fieldset>
  );
}
