"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Minus, Plus, ShoppingBasket } from "lucide-react";
import type { CartView } from "@freshmarkets/contracts";
import { ProductMedia } from "../product-media";
import {
  CART_DRAWER_REQUEST_EVENT,
  addToCart,
  clearCart as clearCartCommand,
} from "../../../lib/storefront/cart-client";
import {
  useAcceptCart,
  useCartQuery,
  useCheckoutDraft,
  useInvalidateCheckoutReads,
} from "../../../lib/query/cart";
import { PromotionEntry } from "../checkout/promotion-entry";
import { OrderSummary } from "./order-summary";
import { CheckoutAuthDialog } from "./checkout-auth-dialog";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);

export function CartDrawer() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const cartQuery = useCartQuery({ enabled: open });
  const cart = cartQuery.cart;
  const checkoutDraft = useCheckoutDraft(cart?.id);
  const loading = open && cartQuery.isPending;
  const [commandError, setCommandError] = useState("");
  const error =
    commandError ||
    (cartQuery.isError ? "Your cart could not be loaded right now." : cartQuery.cartError);
  const acceptCart = useAcceptCart();
  const invalidateCheckout = useInvalidateCheckoutReads();
  const [authOpen, setAuthOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const checkoutAfterClose = useRef(false);
  useEffect(() => {
    setOpen(false);
    setAuthOpen(false);
    setConfirmingClear(false);
  }, [pathname]);

  useEffect(() => {
    const requestOpen = () => {
      setOpen(true);
      setClearError("");
      setCommandError("");
    };
    window.addEventListener(CART_DRAWER_REQUEST_EVENT, requestOpen);
    return () => window.removeEventListener(CART_DRAWER_REQUEST_EVENT, requestOpen);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || (!open && !dialog.open)) return;
    const page = document.documentElement;
    const body = document.body;
    const previous = {
      pageOverflow: page.style.overflow,
      bodyOverflow: body.style.overflow,
      padding: body.style.paddingRight,
    };
    const scrollbarWidth = window.innerWidth - page.clientWidth;
    if (scrollbarWidth > 0)
      body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    page.style.overflow = "hidden";
    body.style.overflow = "hidden";
    const unlock = () => {
      page.style.overflow = previous.pageOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.paddingRight = previous.padding;
    };
    if (open && !dialog.open) dialog.showModal();
    const closing = !open
      ? setTimeout(
          () => {
            unlock();
            dialog.close();
          },
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 240,
        )
      : undefined;
    return () => {
      clearTimeout(closing);
      unlock();
    };
  }, [open]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (confirmingClear && !dialog.open) dialog.showModal();
    if (!confirmingClear && dialog.open) dialog.close();
  }, [confirmingClear]);

  async function update(item: CartView["items"][number], quantity: number) {
    const result = await addToCart(item.skuId, quantity, {
      name: item.name,
      media: item.media,
      unitPriceMinor: item.unitPriceMinor,
      currency: cart?.currency ?? "PHP",
    });
    if (!result.ok) {
      setCommandError(result.message);
      return;
    }
    acceptCart(result.view);
    setCommandError("");
    await invalidateCheckout();
  }

  async function clearCart() {
    if (!cart?.items.length || clearing) return;
    setClearing(true);
    setClearError("");
    try {
      const result = await clearCartCommand(cart);
      if (!result.ok) {
        setClearError(result.message);
        return;
      }
      acceptCart(result.view);
      checkoutDraft.clearPromotions();
      setConfirmingClear(false);
      await invalidateCheckout();
    } catch {
      setClearError("Your cart could not be cleared right now. Try again.");
    } finally {
      setClearing(false);
    }
  }

  const guest = cart?.id === "guest-cart";
  const hasItems = Boolean(cart?.items.length);
  const canClear = hasItems && !loading && !error && !cart?.paymentInProgress;

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-label="Shopping cart"
        data-state={open ? "open" : "closed"}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
          if (checkoutAfterClose.current) {
            checkoutAfterClose.current = false;
            setAuthOpen(true);
          }
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className="fm-cart-drawer fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-md overflow-hidden border-0 bg-transparent p-0"
      >
        <div className="flex h-full flex-col bg-white shadow-[var(--fm-shadow-overlay)]">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--fm-border)] px-5 py-4">
            <h2 className="mt-1 text-xl font-bold">Your cart</h2>
            {canClear ? (
              <button
                type="button"
                onClick={() => {
                  setClearError("");
                  setConfirmingClear(true);
                }}
                className="inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold text-[var(--fm-destructive)] underline-offset-4 hover:underline"
              >
                Clear All
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            {loading ? (
              <div className="space-y-3" aria-label="Loading cart">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded bg-[var(--fm-surface-muted)]"
                  />
                ))}
              </div>
            ) : error ? (
              <div
                role="alert"
                className="rounded-[var(--fm-radius-surface)] bg-[var(--fm-danger-soft)] p-4 text-sm text-[var(--fm-destructive)]"
              >
                {error}
                <button
                  type="button"
                  className="ml-3 inline-flex min-h-11 items-center justify-center underline"
                  onClick={() => void cartQuery.refetch()}
                >
                  Retry loading cart
                </button>
              </div>
            ) : !hasItems ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]">
                  <ShoppingBasket className="size-7" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold">Your cart is empty</h3>
                <p className="mt-1 max-w-xs text-sm text-[var(--fm-text-muted)]">
                  Add a few fresh picks and they will stay saved while you browse.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-4 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-bold text-white hover:bg-[#294f30]"
                >
                  Continue shopping
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {cart?.items.map((item) => (
                  <div
                    key={item.skuId}
                    className="flex gap-3 border-b border-[var(--fm-border)] pb-4"
                  >
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]">
                      <ProductMedia
                        media={item.media ?? null}
                        name={item.name}
                        className="size-16 rounded-[var(--fm-radius-surface)]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs text-[var(--fm-text-muted)]">Fixed pack</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="inline-flex h-9 shrink-0 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.name}`}
                            onClick={() => void update(item, item.quantity - 1)}
                            disabled={clearing || cart?.paymentInProgress}
                            className="inline-flex size-9 items-center justify-center rounded-l-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
                          >
                            <Minus className="size-3.5" aria-hidden="true" />
                          </button>
                          <span className="min-w-8 text-center text-xs font-semibold tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${item.name}`}
                            onClick={() => void update(item, item.quantity + 1)}
                            disabled={
                              clearing ||
                              cart?.paymentInProgress ||
                              item.availability !== "AVAILABLE"
                            }
                            className="inline-flex size-9 items-center justify-center rounded-r-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
                          >
                            <Plus className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <p className="ml-auto shrink-0 whitespace-nowrap text-right text-sm font-bold tabular-nums">
                          {item.regularLineTotalMinor !== undefined ? (
                            <del
                              className="mr-2 text-xs font-normal text-muted-foreground"
                              aria-label="Regular line price"
                            >
                              {money(item.regularLineTotalMinor, cart.currency)}
                            </del>
                          ) : null}
                          {item.lineTotalMinor === null
                            ? item.availability === "PRICE_UNAVAILABLE"
                              ? "Price unavailable"
                              : "Unavailable"
                            : money(item.lineTotalMinor, cart.currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                <PromotionEntry
                  surface="compact"
                  codes={checkoutDraft.draft.promotionCodes}
                  feedback={[]}
                  disabled={clearing || Boolean(cart?.paymentInProgress)}
                  onAdd={(code) =>
                    checkoutDraft.setPromotionCodes([...checkoutDraft.draft.promotionCodes, code])
                  }
                  onRemove={(code) =>
                    checkoutDraft.setPromotionCodes(
                      checkoutDraft.draft.promotionCodes.filter((current) => current !== code),
                    )
                  }
                />
                {guest ? (
                  <p className="rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] p-3 text-xs leading-5 text-[var(--fm-text-muted)]">
                    Your cart is saved on this browser. Sign in only when you are ready to check
                    out.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {hasItems ? (
            <div className="shrink-0 border-t border-[var(--fm-border)] bg-white p-5">
              <OrderSummary
                cart={cart}
                actionLabel={guest ? "Sign in to checkout" : "Continue to checkout"}
                actionHref={guest ? undefined : "/checkout"}
                actionTextClassName="text-white hover:text-white"
                actionTextStyle={{ color: "#ffffff" }}
                surface="flat"
                onAction={
                  guest
                    ? () => {
                        checkoutAfterClose.current = true;
                        setOpen(false);
                      }
                    : undefined
                }
                note="Availability and delivery are confirmed at checkout."
                disabled={clearing || cart?.checkoutBlocked || cart?.paymentInProgress}
              />
            </div>
          ) : null}
        </div>
      </dialog>
      <dialog
        ref={clearDialogRef}
        data-state={confirmingClear ? "open" : "closed"}
        aria-labelledby="clear-cart-title"
        aria-describedby="clear-cart-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!clearing) setConfirmingClear(false);
        }}
        onClick={(event) => {
          if (event.target === clearDialogRef.current && !clearing) setConfirmingClear(false);
        }}
        className="fm-cart-confirm-dialog m-auto w-[calc(100%-2rem)] max-w-sm space-y-4 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-background)] p-5 text-[var(--fm-text)] shadow-xl focus:outline-none"
      >
        <h2 id="clear-cart-title" className="text-lg font-semibold">
          Clear your cart?
        </h2>
        <p id="clear-cart-description" className="text-sm text-[var(--fm-text-muted)]">
          This removes every item from your cart. You can add them again later.
        </p>
        {clearError ? (
          <p
            role="alert"
            className="rounded-[var(--fm-radius-control)] bg-[var(--fm-danger-soft)] p-3 text-sm text-[var(--fm-destructive)]"
          >
            {clearError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={clearing}
            onClick={() => setConfirmingClear(false)}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] px-4 text-sm font-semibold hover:bg-[var(--fm-hover)] disabled:opacity-50"
          >
            {clearError ? "Close" : "Keep items"}
          </button>
          <button
            type="button"
            onClick={() => void clearCart()}
            disabled={clearing || !hasItems}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-destructive)] px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {clearing ? "Clearing…" : clearError ? "Try clearing again" : "Clear All"}
          </button>
        </div>
      </dialog>
      {authOpen ? <CheckoutAuthDialog onClose={() => setAuthOpen(false)} /> : null}
    </>
  );
}
