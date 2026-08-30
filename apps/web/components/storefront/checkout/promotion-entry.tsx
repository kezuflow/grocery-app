"use client";

import { useState, type FormEvent } from "react";
import type { PromotionCodeFeedback } from "@freshmarkets/contracts";

const MAX_PROMOTION_CODES = 5;
const MAX_PROMOTION_CODE_LENGTH = 64;

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
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const [localStatus, setLocalStatus] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("promotionCode") as HTMLInputElement;
    const normalized = input.value.trim().toUpperCase();
    if (!normalized) {
      setLocalStatus("Enter a promotion code first.");
      return;
    }
    if (normalized.length > MAX_PROMOTION_CODE_LENGTH) {
      setLocalStatus(
        `Promotion codes can contain at most ${MAX_PROMOTION_CODE_LENGTH} characters.`,
      );
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
    onAdd(normalized);
    input.value = "";
    setLocalStatus(`${normalized} added. Review the total to check eligibility.`);
  }

  return (
    <section
      aria-labelledby="promotion-heading"
      className="mt-5 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 sm:p-6"
    >
      <h2 id="promotion-heading" className="text-lg font-bold">
        Promotion codes
      </h2>
      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
        Core checks eligibility and chooses at most one merchandise and one delivery benefit.
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="promotion-code">
          Promotion code
        </label>
        <input
          id="promotion-code"
          name="promotionCode"
          aria-label="Promotion code"
          disabled={disabled}
          maxLength={MAX_PROMOTION_CODE_LENGTH}
          autoComplete="off"
          className="min-h-11 flex-1 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 text-sm uppercase"
          placeholder="Enter code"
        />
        <button
          type="submit"
          disabled={disabled || codes.length >= MAX_PROMOTION_CODES}
          className="min-h-11 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add code
        </button>
      </form>
      {codes.length ? (
        <ul aria-label="Added promotion codes" className="mt-4 flex flex-wrap gap-2">
          {codes.map((code) => (
            <li
              key={code}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--fm-surface-soft)] px-3 py-2 text-xs font-semibold"
            >
              <span>{code}</span>
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
      <div aria-live="polite" aria-atomic="true" className="mt-3 space-y-1 text-sm">
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
