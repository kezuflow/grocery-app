"use client";

import { TicketPercent } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PromotionCodeFeedback } from "@freshmarkets/contracts";
import { promotionCodeMaxLength } from "@freshmarkets/validation";

const MAX_PROMOTION_CODES = 5;

export function PromotionEntry({
  codes,
  feedback,
  disabled,
  onAdd,
  onRemove,
}: {
  codes: readonly string[];
  feedback: readonly PromotionCodeFeedback[];
  disabled: boolean;
  onAdd: (code: string) => void | boolean | Promise<void | boolean>;
  onRemove: (code: string) => void;
}) {
  const [localStatus, setLocalStatus] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("promotionCode") as HTMLInputElement;
    const normalized = input.value.trim().toUpperCase();
    if (!normalized) {
      setLocalStatus("Enter a promotion code first.");
      return;
    }
    if (normalized.length > promotionCodeMaxLength) {
      setLocalStatus(`Promotion codes can contain at most ${promotionCodeMaxLength} characters.`);
      return;
    }
    if (codes.includes(normalized)) {
      setLocalStatus(`${normalized} is already added.`);
      return;
    }
    if (codes.length >= MAX_PROMOTION_CODES) {
      setLocalStatus(`You can review at most ${MAX_PROMOTION_CODES} promotion codes at once.`);
      return;
    }
    try {
      if ((await onAdd(normalized)) === false) {
        setLocalStatus("The code was not added. Release the current checkout and try again.");
        return;
      }
    } catch {
      setLocalStatus("The code could not be added. Try again.");
      return;
    }
    input.value = "";
    setLocalStatus(`${normalized} added. Review the total to check eligibility.`);
  }

  return (
    <section
      aria-labelledby="promotion-heading"
      className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 shadow-[var(--fm-shadow-card)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]">
          <TicketPercent className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fm-text-muted)]">
            Optional
          </p>
          <h2 id="promotion-heading" className="mt-1 text-xl font-bold">
            Add a promotion code
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--fm-text-muted)]">
            Add a code now. Eligible merchandise and delivery benefits appear in your total.
          </p>
        </div>
      </div>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="promotion-code">
          Promotion code
        </label>
        <input
          id="promotion-code"
          name="promotionCode"
          aria-label="Promotion code"
          disabled={disabled}
          maxLength={promotionCodeMaxLength}
          autoComplete="off"
          className="min-h-12 flex-1 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-4 text-sm uppercase focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
          placeholder="Enter promotion code"
        />
        <button
          type="submit"
          disabled={disabled || codes.length >= MAX_PROMOTION_CODES}
          className="min-h-12 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-5 text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          Add code
        </button>
      </form>
      {codes.length ? (
        <ul aria-label="Added promotion codes" className="mt-4 flex flex-wrap gap-2">
          {codes.map((code) => (
            <li
              key={code}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--fm-surface-soft)] px-3 py-2 text-xs font-semibold"
            >
              <span className="min-w-0 break-all">{code}</span>
              <button
                type="button"
                aria-label={`Remove ${code} promotion code`}
                onClick={() => onRemove(code)}
                disabled={disabled}
                className="underline underline-offset-2 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="mt-3 space-y-1 text-sm [overflow-wrap:anywhere]"
      >
        {localStatus ? <p>{localStatus}</p> : null}
        {feedback.map((entry) => (
          <p
            key={`${entry.code}-${entry.status}`}
            className={
              entry.status === "APPLIED"
                ? "text-[var(--fm-success)]"
                : "text-[var(--fm-text-muted)]"
            }
          >
            <strong>{entry.code}:</strong> {entry.message}
          </p>
        ))}
      </div>
    </section>
  );
}
