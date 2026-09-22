"use client";

import Link from "next/link";
import { ArrowRight, Info, Minus, Plus, ShoppingBasket } from "lucide-react";
import type { CartView, CheckoutQuoteView } from "@freshmarkets/contracts";
import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "../../../lib/utils";
import {
  cartItemsWithPending,
  type PendingCartQuantity,
} from "../../../lib/query/cart-quantity-queue";
import { ProductMedia } from "../product-media";
import { QuantityPendingSpinner } from "./quantity-pending-spinner";

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
  quoteState = "needs-input",
  showItems = false,
  onQuantityChange,
  pendingQuantities,
  quantityControlsDisabled = false,
  surface = "card",
  actionTextClassName,
  actionTextStyle,
}: {
  cart: CartView | null;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  disabled?: boolean;
  note?: string;
  totalMinor?: number;
  quote?: CheckoutQuoteView;
  quoteState?: "needs-input" | "quoting" | "ready" | "refreshing" | "error";
  showItems?: boolean;
  onQuantityChange?: (item: CartView["items"][number], quantity: number) => void;
  pendingQuantities?: ReadonlyMap<string, PendingCartQuantity>;
  quantityControlsDisabled?: boolean;
  surface?: "card" | "flat";
  actionTextClassName?: string;
  actionTextStyle?: CSSProperties;
}) {
  const currency = quote?.currency ?? cart?.currency ?? "PHP";
  const subtotal = cart?.totalMinor ?? 0;
  const total = totalMinor ?? quote?.totalMinor ?? subtotal;
  const pricesAvailable = !cart?.items.some((item) => item.lineTotalMinor === null);
  const itemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const displayItems = cartItemsWithPending(cart, pendingQuantities ?? new Map());
  const flat = surface === "flat";
  const [resolvedValuesVisible, setResolvedValuesVisible] = useState(Boolean(quote));
  useEffect(() => {
    if (!quote) {
      setResolvedValuesVisible(false);
      return;
    }
    setResolvedValuesVisible(false);
    const timer = window.setTimeout(() => setResolvedValuesVisible(true), 0);
    return () => window.clearTimeout(timer);
  }, [quote?.quoteId, quote?.attemptVersion]);
  const resolvedValueClass = cn(
    "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
    quote && resolvedValuesVisible ? "translate-y-0 opacity-100" : "translate-y-0.5 opacity-80",
  );

  return (
    <aside
      aria-label="Order summary"
      className={cn(
        flat
          ? "border-y border-[var(--fm-border)] py-5"
          : "rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 shadow-[var(--fm-shadow-card)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
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
          {displayItems.length ? (
            displayItems.map((item) => {
              const pending = pendingQuantities?.get(item.skuId);
              const updating = Boolean(pending);
              return (
                <div key={item.skuId} className="flex gap-3 py-4" aria-busy={updating}>
                  <ProductMedia
                    media={item.media ?? null}
                    name={item.name}
                    className={cn(
                      "size-14 shrink-0",
                      flat
                        ? "rounded-none bg-transparent"
                        : "rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)]",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">Fixed pack</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="inline-flex h-9 shrink-0 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
                        <button
                          type="button"
                          aria-label={`Decrease ${item.name}`}
                          disabled={
                            !onQuantityChange ||
                            quantityControlsDisabled ||
                            (pending?.quantity ?? item.quantity) <= 0
                          }
                          onClick={() => onQuantityChange?.(item, item.quantity - 1)}
                          className="inline-flex size-9 items-center justify-center rounded-l-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
                        >
                          <Minus className="size-3.5" aria-hidden="true" />
                        </button>
                        <span className="min-w-8 text-center text-xs font-semibold tabular-nums">
                          {pending?.quantity ?? item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${item.name}`}
                          disabled={
                            !onQuantityChange ||
                            quantityControlsDisabled ||
                            item.availability !== "AVAILABLE"
                          }
                          onClick={() => onQuantityChange?.(item, item.quantity + 1)}
                          className="inline-flex size-9 items-center justify-center rounded-r-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      {updating ? <QuantityPendingSpinner /> : null}
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
                    {item.unavailableReason ? (
                      <p
                        role="status"
                        className="mt-2 text-xs font-medium text-[var(--fm-destructive)]"
                      >
                        {item.unavailableReason === "INSUFFICIENT_QUANTITY"
                          ? `${item.availableQuantity ?? 0} available at this destination. Reduce the quantity or remove this item.`
                          : item.unavailableReason === "PRICE_UNAVAILABLE"
                            ? "No current price is available at this destination. Remove this item to continue."
                            : "This item is not sold at this destination. Remove it to continue."}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-5 text-sm text-[var(--fm-text-muted)]">Your cart is empty.</p>
          )}
        </div>
      ) : null}

      {quote?.promotionFeedback.length ? (
        <div className="mt-4 border-t border-[var(--fm-border)] pt-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Promo codes</span>
            <Link href="/cart" className="font-semibold underline underline-offset-4">
              Edit in cart
            </Link>
          </div>
          <ul className="mt-2 space-y-1" aria-label="Promotion code results">
            {quote.promotionFeedback.map((entry) => (
              <li
                key={`${entry.code}-${entry.status}`}
                className={
                  entry.status === "APPLIED"
                    ? "text-[var(--fm-success)]"
                    : "text-[var(--fm-text-muted)]"
                }
              >
                <strong>{entry.code}:</strong> {entry.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {quote?.promotionApplications.length ? (
        <div className="mt-3 text-xs text-[var(--fm-text-muted)]">
          <p className="font-semibold text-[var(--fm-text)]">Applied savings</p>
          <ul className="mt-1 space-y-1" aria-label="Applied promotions">
            {quote.promotionApplications.map((application) => (
              <li key={application.promotionId}>
                {application.name}
                {application.automatic ? " · Automatic" : ` · ${application.code}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className={cn(
          "space-y-3 text-sm",
          showItems ? "mt-4" : "mt-5 border-t border-[var(--fm-border)] pt-4",
        )}
      >
        <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
          <span className="text-[var(--fm-text)]">
            {showItems ? "Items subtotal" : `Items (${itemCount})`}
          </span>
          <span className="font-medium tabular-nums text-[var(--fm-text)]">
            {pricesAvailable
              ? money(quote?.merchandiseSubtotalMinor ?? subtotal, currency)
              : "Price unavailable"}
          </span>
        </div>
        {quote ? (
          <>
            {quote.itemDiscountMinor > 0 ? (
              <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
                <span>Item discounts</span>
                <span
                  className={cn(
                    "min-w-[5.5rem] text-right font-medium tabular-nums text-[var(--fm-success)]",
                    resolvedValueClass,
                  )}
                >
                  −{money(quote.itemDiscountMinor, currency)}
                </span>
              </div>
            ) : null}
            {quote.orderDiscountMinor > 0 ? (
              <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
                <span>Order discount</span>
                <span
                  className={cn(
                    "min-w-[5.5rem] text-right font-medium tabular-nums text-[var(--fm-success)]",
                    resolvedValueClass,
                  )}
                >
                  −{money(quote.orderDiscountMinor, currency)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
              <span>Delivery</span>
              <span
                className={cn(
                  "min-w-[5.5rem] text-right font-medium tabular-nums text-[var(--fm-text)]",
                  resolvedValueClass,
                )}
              >
                {money(quote.deliverySubtotalMinor, currency)}
              </span>
            </div>
            {quote.deliveryDiscountMinor > 0 ? (
              <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
                <span>Delivery discount</span>
                <span
                  className={cn(
                    "min-w-[5.5rem] text-right font-medium tabular-nums text-[var(--fm-success)]",
                    resolvedValueClass,
                  )}
                >
                  −{money(quote.deliveryDiscountMinor, currency)}
                </span>
              </div>
            ) : null}
            {quote.taxMinor > 0 ? (
              <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
                <span>Tax</span>
                <span
                  className={cn(
                    "min-w-[5.5rem] text-right font-medium tabular-nums text-[var(--fm-text)]",
                    resolvedValueClass,
                  )}
                >
                  {money(quote.taxMinor, currency)}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 text-[var(--fm-text-muted)]">
            <span className="fm-shine-text text-[var(--fm-text)]" data-text="Delivery fee">
              Delivery fee
            </span>
            <span className="sr-only">Delivery fee pending</span>
            <span
              aria-hidden="true"
              className="min-w-[4.5rem] select-none text-right font-medium tabular-nums text-[var(--fm-text)] blur-[4px]"
            >
              {money(0, currency)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--fm-border)] pt-3 text-base font-bold">
          <span>{quote ? "Total" : "Amount before delivery"}</span>
          <span className={cn("min-w-[6rem] text-right tabular-nums", resolvedValueClass)}>
            {pricesAvailable ? money(total, currency) : "Price unavailable"}
          </span>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {quote
          ? `Delivery fee ${money(quote.deliveryFeeMinor, currency)}. Total ${money(quote.totalMinor, currency)}.`
          : quoteState === "quoting" || quoteState === "refreshing"
            ? "Checking delivery fee and total."
            : ""}
      </p>

      <div
        className={cn(
          "mt-4 flex gap-2 text-xs leading-5 text-[var(--fm-text-muted)]",
          flat
            ? "border-t border-[var(--fm-border)] pt-3"
            : "rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-3",
        )}
      >
        <Info className="mt-0.5 size-4 shrink-0 text-[var(--fm-primary-dark)]" aria-hidden="true" />
        <span>
          {note ??
            (quote
              ? quoteState === "error"
                ? "This total is not ready for payment. Retry the delivery quotation."
                : `Current total valid until ${new Date(quote.expiresAt).toLocaleString()}.`
              : "Availability and delivery are confirmed at checkout.")}
        </span>
      </div>

      {quote ? (
        <p className="mt-3 text-xs leading-5 text-[var(--fm-text-muted)]">
          Please be available to receive your delivery. A missed delivery does not create an
          automatic refund; FreshMarkets reviews responsibility and any courier cost. Any extra
          redelivery charge requires your agreement. Your rights for faulty goods or delivery remain
          unchanged.
        </p>
      ) : null}

      {actionHref ? (
        <Link
          href={actionHref}
          aria-disabled={disabled}
          style={actionTextStyle}
          className={cn(
            "mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#294f30] hover:text-white active:scale-[0.985]",
            disabled && "pointer-events-none opacity-50",
            actionTextClassName,
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
          style={actionTextStyle}
          className={cn(
            "mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#294f30] hover:text-white active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:text-white disabled:active:scale-100",
            actionTextClassName,
          )}
        >
          {actionLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
