"use client";

import { LoaderCircle, TicketPercent, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { PromotionCodeFeedback } from "@freshmarkets/contracts";
import { promotionCodeMaxLength } from "@freshmarkets/validation";
import { cn } from "../../../lib/utils";

const MAX_PROMOTION_CODES = 5;

export function PromotionEntry({
  codes,
  feedback,
  disabled,
  onAdd,
  onRemove,
  surface = "card",
}: {
  codes: readonly string[];
  feedback: readonly PromotionCodeFeedback[];
  disabled: boolean;
  onAdd: (code: string) => void | boolean | Promise<void | boolean>;
  onRemove: (code: string) => void | Promise<void>;
  surface?: "card" | "flat" | "compact";
}) {
  const [localStatus, setLocalStatus] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const instanceId = useId();
  const headingId = `${instanceId}-promotion-heading`;
  const inputId = `${instanceId}-promotion-code`;
  const flat = surface === "flat";
  const compact = surface === "compact";

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
      setLocalStatus("");
      setPendingAction(`add:${normalized}`);
      if ((await onAdd(normalized)) === false) {
        setLocalStatus("The code was not added. Release the current checkout and try again.");
        return;
      }
    } catch {
      setLocalStatus("The code could not be added. Try again.");
      return;
    } finally {
      setPendingAction("");
    }
    input.value = "";
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        compact
          ? "border-t border-[var(--fm-border)] pt-4"
          : flat
            ? "border-b border-[var(--fm-border)] pb-7 pt-7"
            : "rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 shadow-[var(--fm-shadow-card)] sm:p-6",
      )}
    >
      <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
        <span
          className={cn(
            "grid shrink-0 place-items-center text-[var(--fm-primary-dark)]",
            compact ? "size-7" : "size-10",
            !flat && "rounded-full bg-[var(--fm-surface-soft)]",
          )}
        >
          <TicketPercent className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        </span>
        <div>
          <h2 id={headingId} className={cn("font-bold", compact ? "text-sm" : "mt-1 text-xl")}>
            {compact ? "Promo code" : "Add a promotion code"}
          </h2>
          <p
            className={cn(
              "mt-1 text-[var(--fm-text-muted)]",
              compact ? "text-xs" : "text-sm leading-6",
            )}
          >
            {compact
              ? "Eligibility is checked with your delivery total at checkout."
              : "Add a code now. Eligible merchandise and delivery benefits appear in your total."}
          </p>
        </div>
      </div>
      <form
        className={cn("flex gap-2", compact ? "mt-3" : "mt-4 flex-col sm:flex-row")}
        onSubmit={submit}
      >
        <label className="sr-only" htmlFor={inputId}>
          Promotion code
        </label>
        <input
          id={inputId}
          name="promotionCode"
          aria-label="Promotion code"
          disabled={disabled || Boolean(pendingAction)}
          maxLength={promotionCodeMaxLength}
          autoComplete="off"
          className={cn(
            "min-w-0 flex-1 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-3 text-sm uppercase focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]",
            compact ? "min-h-10" : "min-h-12 px-4",
          )}
          placeholder="Enter promotion code"
        />
        <button
          type="submit"
          disabled={disabled || Boolean(pendingAction) || codes.length >= MAX_PROMOTION_CODES}
          className={cn(
            "rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--fm-storefront-action-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
            compact ? "min-h-10 px-4" : "min-h-12 px-5",
          )}
        >
          {pendingAction.startsWith("add:") ? "Adding…" : compact ? "Add" : "Add code"}
        </button>
      </form>
      {codes.length ? (
        <ul aria-label="Added promotion codes" className="mt-4 flex flex-wrap gap-2">
          {codes.map((code) => (
            <li
              key={code}
              aria-busy={pendingAction === `remove:${code}`}
              className={cn(
                "inline-flex max-w-full items-stretch overflow-hidden rounded-[var(--fm-radius-control)] border border-dashed border-[var(--fm-primary-dark)] text-[var(--fm-primary-dark)]",
                flat ? "bg-transparent" : "bg-[var(--fm-surface-soft)]",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 px-3 py-2">
                <TicketPercent className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-all font-mono text-xs font-bold tracking-wide">
                  {code}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${code} promotion code`}
                onClick={async () => {
                  setLocalStatus("");
                  setPendingAction(`remove:${code}`);
                  try {
                    await onRemove(code);
                  } catch {
                    setLocalStatus(`${code} could not be removed. Try again.`);
                  } finally {
                    setPendingAction("");
                  }
                }}
                disabled={disabled || Boolean(pendingAction)}
                className="grid size-11 shrink-0 place-items-center border-l border-dashed border-[var(--fm-primary-dark)] hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fm-focus)] disabled:cursor-wait disabled:opacity-50"
              >
                {pendingAction === `remove:${code}` ? (
                  <LoaderCircle
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "space-y-1 text-sm [overflow-wrap:anywhere]",
          localStatus || feedback.length ? "mt-3" : "sr-only",
        )}
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
