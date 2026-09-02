"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Leaf, Minus, Plus, X } from "lucide-react";
import type { MarketplaceProductView } from "@freshmarkets/contracts";
import { formatMoney, toPresentationProduct } from "../../../lib/storefront/catalog-presentation";
import type { PresentationProduct } from "../../../lib/storefront/catalog-presentation";
import { addToCart, announceToast } from "../../../lib/storefront/cart-client";
import { cn } from "../../../lib/utils";

/**
 * Product quick-add overlay rendered in a native dialog: media, fixed variant
 * picker, quantity, same-category recommendations, and a total-aware sticky
 * add action. Variant selection stays fixed and explicit — no arbitrary
 * weights. Full product pages remain at /products/[slug].
 */
export function ProductQuickView({
  slug,
  products,
  onClose,
  onNavigate,
}: {
  slug: string | null;
  products: ReadonlyArray<PresentationProduct>;
  onClose: () => void;
  onNavigate: (slug: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<MarketplaceProductView | null>(null);
  const [loading, setLoading] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!slug) {
      dialog?.close();
      setView(null);
      setVariantId("");
      setQuantity(1);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/catalog/product?slug=${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then(
        (response) => response.json() as Promise<{ ok?: boolean; value?: MarketplaceProductView }>,
      )
      .then((result) => {
        const next = result.value ?? null;
        setView(next);
        const presentation = next ? toPresentationProduct(next.product) : null;
        setVariantId(presentation?.defaultVariant?.id ?? next?.product.variants[0]?.id ?? "");
        setQuantity(1);
        if (dialog && !dialog.open) dialog.showModal();
      })
      .catch(() => {
        if (!controller.signal.aborted) setView(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  const presentation = view ? toPresentationProduct(view.product) : null;
  const variants = presentation?.variants ?? [];
  const selected = variants.find((variant) => variant.id === variantId) ?? null;
  const recommendations = (
    presentation
      ? products.filter((product) => {
          return (
            product.categorySlug === presentation.categorySlug && product.slug !== presentation.slug
          );
        })
      : []
  ).slice(0, 6);

  async function add() {
    if (
      !selected ||
      selected.priceMinor === null ||
      selected.availability !== "AVAILABLE" ||
      !presentation
    )
      return;
    setPending(true);
    const result = await addToCart(selected.id, quantity, {
      name: presentation.name,
      unitPriceMinor: selected.priceMinor,
      currency: selected.currency ?? "PHP",
    });
    setPending(false);
    if (result.ok) {
      announceToast({
        message: result.requiresSignIn
          ? `${quantity} × ${presentation.name} added to your cart. Sign in to continue when you’re ready.`
          : `${quantity} × ${presentation.name} added to cart.`,
        tone: "success",
        signInHref: result.requiresSignIn ? "/auth/login?returnTo=/cart" : undefined,
      });
      onClose();
      return;
    }
    if (result.reason === "unauthenticated") {
      announceToast({
        message: "Sign in to add items to your cart.",
        tone: "error",
        signInHref: "/auth/login",
      });
      return;
    }
    announceToast({ message: result.message, tone: "error" });
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-label={presentation ? `${presentation.name} details` : "Product details"}
      className="m-auto w-full max-w-3xl bg-transparent p-0 backdrop:bg-black/45"
    >
      {loading ? (
        <div
          className="space-y-4 rounded-[var(--fm-radius-dialog)] bg-white p-6"
          aria-label="Loading product"
        >
          <div className="h-64 animate-pulse rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-muted)]" />
          <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--fm-surface-muted)]" />
          <div className="h-10 w-full animate-pulse rounded bg-[var(--fm-surface-muted)]" />
        </div>
      ) : !presentation ? (
        <div role="alert" className="rounded-[var(--fm-radius-dialog)] bg-white p-8 text-center">
          <h2 className="text-lg font-bold">Product unavailable</h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            This grocery could not be loaded.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 inline-flex min-h-10 items-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-semibold text-white"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="max-h-[85vh] overflow-y-auto rounded-[var(--fm-radius-dialog)] bg-white shadow-[var(--fm-shadow-popover)]">
          <div className="flex items-center justify-between border-b border-[var(--fm-border)] px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              {presentation.categoryName}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close product details"
              className="inline-flex size-10 items-center justify-center rounded-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:p-6">
            <div className="rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-4">
              {presentation.media ? (
                <img
                  src={presentation.media.src}
                  alt={presentation.media.alt}
                  className="aspect-square w-full object-contain"
                />
              ) : (
                <div
                  role="img"
                  aria-label={`${presentation.name} product image`}
                  className="flex aspect-square w-full items-center justify-center text-[var(--fm-primary-dark)]"
                >
                  <Leaf className="size-16 stroke-[1.25]" aria-hidden="true" />
                </div>
              )}
            </div>
            <div>
              <h2 className="text-[32px] leading-[42px] font-semibold">{presentation.name}</h2>
              <p
                className={cn(
                  "mt-1 flex items-center gap-1.5 text-sm leading-[22px] font-semibold",
                  presentation.available
                    ? "text-[var(--fm-success)]"
                    : "text-[var(--fm-destructive)]",
                )}
              >
                <span
                  className="inline-block size-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {presentation.available ? "Available for delivery" : "Currently unavailable"}
              </p>
              {presentation.description ? (
                <p className="mt-3 text-sm leading-[22px] text-[var(--fm-text-muted)]">
                  {presentation.description}
                </p>
              ) : null}
              <fieldset className="mt-5">
                <legend className="flex w-full items-center justify-between text-sm font-semibold">
                  Choose a fixed pack
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">Required</span>
                </legend>
                <div className="mt-2 space-y-2">
                  {variants.map((variant) => (
                    <label
                      key={variant.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--fm-radius-surface)] border p-3 text-sm has-[:checked]:border-[var(--fm-primary-dark)] has-[:checked]:bg-[var(--fm-surface-soft)]",
                        variant.availability !== "AVAILABLE"
                          ? "border-[var(--fm-border)] opacity-60"
                          : "border-[var(--fm-border)]",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="quick-view-variant"
                          value={variant.id}
                          checked={variantId === variant.id}
                          onChange={() => setVariantId(variant.id)}
                          disabled={variant.availability !== "AVAILABLE"}
                          className="size-4 accent-[var(--fm-primary-dark)]"
                        />
                        <span className="font-semibold">{variant.label}</span>
                      </span>
                      <span className="fm-font-display text-base font-bold tabular-nums">
                        {variant.availability === "OUT_OF_STOCK"
                          ? "Out of stock"
                          : variant.priceMinor === null || variant.currency === null
                            ? "Unavailable"
                            : formatMoney(variant.priceMinor, variant.currency)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {selected?.contentsNote ? (
                <p className="mt-3 rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-3 text-xs leading-5 text-[var(--fm-text-muted)]">
                  {selected.contentsNote}
                </p>
              ) : null}
              {presentation.details.length > 0 ? (
                <dl className="mt-4 space-y-1.5 border-t border-[var(--fm-border)] pt-4">
                  {presentation.details.map((detail) => (
                    <div key={detail.label} className="flex gap-2 text-xs leading-5">
                      <dt className="shrink-0 font-semibold text-[var(--fm-primary-dark)]">
                        {detail.label}
                      </dt>
                      <dd className="text-[var(--fm-text-muted)]">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {recommendations.length > 0 ? (
                <div className="mt-5">
                  <p className="text-sm font-semibold">More from {presentation.categoryName}</p>
                  <div className="fm-scrollbar-none -mx-1 mt-2 flex gap-3 overflow-x-auto px-1 pb-1">
                    {recommendations.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => onNavigate(product.slug)}
                        className="w-24 shrink-0 rounded-[var(--fm-radius-surface)] p-1 text-left hover:bg-[var(--fm-hover)]"
                      >
                        {product.media ? (
                          <img
                            src={product.media.src}
                            alt=""
                            className="aspect-square w-full rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] object-contain"
                          />
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]">
                            <Leaf className="size-6 stroke-[1.25]" aria-hidden="true" />
                          </div>
                        )}
                        <span className="mt-1 block line-clamp-2 text-xs font-semibold">
                          {product.name}
                        </span>
                        {product.defaultVariant?.priceMinor != null &&
                        product.defaultVariant.currency ? (
                          <span className="fm-font-display block text-xs font-semibold tabular-nums text-[var(--fm-text-muted)]">
                            {formatMoney(
                              product.defaultVariant.priceMinor,
                              product.defaultVariant.currency,
                            )}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <Link
                href={`/products/${presentation.slug}`}
                className="mt-4 inline-flex text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
              >
                View full details
              </Link>
            </div>
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--fm-border)] bg-white px-5 py-3 sm:px-6">
            <div className="inline-flex h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                className="inline-flex size-11 items-center justify-center rounded-l-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <span
                className="min-w-10 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQuantity((current) => Math.min(99, current + 1))}
                className="inline-flex size-11 items-center justify-center rounded-r-[var(--fm-radius-control)] hover:bg-[var(--fm-hover)]"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void add()}
              disabled={
                pending ||
                !selected ||
                selected.priceMinor === null ||
                selected.availability !== "AVAILABLE"
              }
              className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-4 text-sm font-bold text-[var(--fm-primary-dark)] transition-colors hover:bg-[#a9e83f] disabled:opacity-60 sm:flex-none sm:px-6"
            >
              {selected && selected.priceMinor !== null && selected.currency
                ? `Add to cart · ${formatMoney(selected.priceMinor * quantity, selected.currency)}`
                : "Add to cart"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
