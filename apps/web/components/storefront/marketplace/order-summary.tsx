import Link from "next/link";
import { Info, ShoppingBasket } from "lucide-react";
import type { CartView, CheckoutQuoteView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function OrderSummary({
  cart,
  actionLabel,
  actionHref,
  onAction,
  disabled = false,
  note,
  totalMinor,
  quote,
}: {
  cart: CartView | null;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  disabled?: boolean;
  note?: string;
  totalMinor?: number;
  quote?: CheckoutQuoteView;
}) {
  const currency = cart?.currency ?? "PHP";
  const subtotal = cart?.totalMinor ?? 0;
  const total = totalMinor ?? subtotal;
  const itemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <aside
      aria-label="Order summary"
      className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 shadow-[var(--fm-shadow-card)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Your order
          </p>
          <h2 className="mt-1 text-lg font-bold">Summary</h2>
        </div>
        <ShoppingBasket className="size-5 text-[var(--fm-primary-dark)]" aria-hidden="true" />
      </div>

      <div className="mt-5 space-y-3 border-t border-[var(--fm-border)] pt-4 text-sm">
        <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
          <span>Items ({itemCount})</span>
          <span className="font-medium tabular-nums text-[var(--fm-text)]">
            {money(subtotal, currency)}
          </span>
        </div>
        {quote ? (
          <>
            <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
              <span>Merchandise discount</span>
              <span className="font-medium tabular-nums text-[var(--fm-success)]">
                −{money(quote.itemDiscountMinor + quote.orderDiscountMinor, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
              <span>Delivery</span>
              <span className="font-medium tabular-nums text-[var(--fm-text)]">
                {money(quote.deliverySubtotalMinor, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
              <span>Delivery discount</span>
              <span className="font-medium tabular-nums text-[var(--fm-success)]">
                −{money(quote.deliveryDiscountMinor, currency)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
            <span>Delivery fee</span>
            <span className="font-medium text-[var(--fm-text)]">Calculated at checkout</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--fm-border)] pt-3 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{money(total, currency)}</span>
        </div>
      </div>

      <div className="mt-4 flex gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-3 text-xs leading-5 text-[var(--fm-text-muted)]">
        <Info className="mt-0.5 size-4 shrink-0 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        <span>
          {note ?? "Minimum order, availability, and delivery are confirmed at checkout."}
        </span>
      </div>

      {actionHref ? (
        <Link
          href={actionHref}
          aria-disabled={disabled}
          className={cn(
            "mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-4 text-sm font-bold text-[var(--fm-primary-dark)] transition-colors hover:bg-[#c4fa69]",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          {actionLabel}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-4 text-sm font-bold text-[var(--fm-primary-dark)] transition-colors hover:bg-[#c4fa69] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </aside>
  );
}
