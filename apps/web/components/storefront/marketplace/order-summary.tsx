import Link from "next/link";
import { ArrowRight, Info, Minus, Plus, ShoppingBasket } from "lucide-react";
import type { CartView, CheckoutQuoteView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";
import { ProductMedia } from "../product-media";

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
  showItems = false,
  onQuantityChange,
  updatingSkuId,
}: {
  cart: CartView | null;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  disabled?: boolean;
  note?: string;
  totalMinor?: number;
  quote?: CheckoutQuoteView;
  showItems?: boolean;
  onQuantityChange?: (item: CartView["items"][number], quantity: number) => void;
  updatingSkuId?: string | null;
}) {
  const currency = cart?.currency ?? "PHP";
  const subtotal = cart?.totalMinor ?? 0;
  const total = totalMinor ?? subtotal;
  const pricesAvailable = !cart?.items.some((item) => item.lineTotalMinor === null);
  const itemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <aside
      aria-label="Order summary"
      className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 shadow-[var(--fm-shadow-card)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          {showItems ? null : (
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              Your order
            </p>
          )}
          <h2 className={cn("text-lg font-bold", !showItems && "mt-1")}>
            {showItems ? "Order summary" : "Summary"}
          </h2>
        </div>
        {showItems ? (
          <span className="text-xs font-semibold text-[var(--fm-text-muted)]">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        ) : (
          <ShoppingBasket className="size-5 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        )}
      </div>

      {showItems ? (
        <div className="mt-4 divide-y divide-[var(--fm-border)] border-y border-[var(--fm-border)]">
          {cart?.items.length ? (
            cart.items.map((item) => {
              const updating = updatingSkuId === item.skuId;
              return (
                <div key={item.skuId} className="flex gap-3 py-4" aria-busy={updating}>
                  <ProductMedia
                    media={item.media ?? null}
                    name={item.name}
                    className="size-14 shrink-0 rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">Fixed pack</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="inline-flex h-9 shrink-0 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
                        <button
                          type="button"
                          aria-label={`Decrease ${item.name}`}
                          disabled={!onQuantityChange || updating}
                          onClick={() => onQuantityChange?.(item, item.quantity - 1)}
                          className="inline-flex size-9 items-center justify-center rounded-l-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
                        >
                          <Minus className="size-3.5" aria-hidden="true" />
                        </button>
                        <span className="min-w-8 text-center text-xs font-semibold tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${item.name}`}
                          disabled={
                            !onQuantityChange || updating || item.availability !== "AVAILABLE"
                          }
                          onClick={() => onQuantityChange?.(item, item.quantity + 1)}
                          className="inline-flex size-9 items-center justify-center rounded-r-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="ml-auto shrink-0 whitespace-nowrap text-right text-sm font-bold tabular-nums">
                        {item.regularLineTotalMinor !== undefined ? (
                          <del
                            className="mr-1.5 text-[11px] font-normal text-[var(--fm-text-muted)]"
                            aria-label="Regular line price"
                          >
                            {money(item.regularLineTotalMinor, currency)}
                          </del>
                        ) : null}
                        {item.lineTotalMinor === null
                          ? item.availability === "PRICE_UNAVAILABLE"
                            ? "Price unavailable"
                            : "Unavailable"
                          : money(item.lineTotalMinor, currency)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-5 text-sm text-[var(--fm-text-muted)]">Your cart is empty.</p>
          )}
        </div>
      ) : null}

      <div
        className={cn(
          "space-y-3 text-sm",
          showItems ? "mt-4" : "mt-5 border-t border-[var(--fm-border)] pt-4",
        )}
      >
        <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
          <span>{showItems ? "Items subtotal" : `Items (${itemCount})`}</span>
          <span className="font-medium tabular-nums text-[var(--fm-text)]">
            {pricesAvailable ? money(subtotal, currency) : "Price unavailable"}
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
          <span className="tabular-nums">
            {pricesAvailable ? money(total, currency) : "Price unavailable"}
          </span>
        </div>
      </div>

      <div className="mt-4 flex gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-3 text-xs leading-5 text-[var(--fm-text-muted)]">
        <Info className="mt-0.5 size-4 shrink-0 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        <span>{note ?? "Availability and delivery are confirmed at checkout."}</span>
      </div>

      {actionHref ? (
        <Link
          href={actionHref}
          aria-disabled={disabled}
          className={cn(
            "mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#294f30] active:scale-[0.985]",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          {actionLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#294f30] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {actionLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
