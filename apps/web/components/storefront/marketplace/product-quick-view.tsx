"use client";

import { readJson } from "../../../lib/http/read-deadline";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { ProductMedia } from "../product-media";
import { ProductGallery } from "../product-gallery";
import { ProductPrice } from "../product-price";
import { Button } from "../../ui/button";
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
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [showLoadingLayer, setShowLoadingLayer] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!slug) {
      dialog?.close();
      setView(null);
      setLoading(false);
      setShowLoadingLayer(false);
      setVariantId("");
      setQuantity(1);
      return;
    }
    const controller = new AbortController();
    setView(null);
    setLoading(true);
    if (dialog && !dialog.open) dialog.showModal();
    void readJson<{ ok?: boolean; value?: MarketplaceProductView }>(
      `/api/catalog/product?slug=${encodeURIComponent(slug)}`,
      {
        signal: controller.signal,
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const next = result.ok ? (result.value ?? null) : null;
        setView(next);
        const presentation = next ? toPresentationProduct(next.product) : null;
        setVariantId(presentation?.defaultVariant?.id ?? next?.product.variants[0]?.id ?? "");
        setQuantity(1);
      })
      .catch(() => {
        if (!controller.signal.aborted) setView(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, attempt]);

  useEffect(() => {
    if (loading) {
      setShowLoadingLayer(true);
      return;
    }
    const timer = window.setTimeout(() => setShowLoadingLayer(false), 150);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const presentation = view ? toPresentationProduct(view.product) : null;
  const preview = products.find((product) => product.slug === slug);
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
      media: presentation.media,
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
      className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-visible border-0 bg-transparent p-0 backdrop:bg-black/45"
    >
      <div className="grid max-h-[min(85dvh,800px)] overflow-hidden rounded-[var(--fm-radius-overlay)] bg-white shadow-[var(--fm-shadow-overlay)]">
        {showLoadingLayer || loading ? (
          <div
            data-loading={loading}
            inert={!loading}
            aria-hidden={!loading}
            className="fm-quick-view-loading relative z-10 col-start-1 row-start-1 min-h-0 space-y-4 overflow-y-auto bg-white p-6"
            aria-label="Loading product"
            aria-busy="true"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close product details"
              className="absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-full bg-white hover:bg-[var(--fm-hover)]"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            {preview ? (
              <>
                <div className="mx-auto max-w-64">
                  <ProductMedia media={preview.media} name={preview.name} />
                </div>
                <h2 className="text-2xl font-semibold">{preview.name}</h2>
              </>
            ) : (
              <div className="h-64 animate-pulse rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-muted)] motion-reduce:animate-none" />
            )}
            <p role="status" className="text-sm text-[var(--fm-text-muted)]">
              Loading current options and availability…
            </p>
          </div>
        ) : null}
        {!loading && !presentation ? (
          <div
            role="alert"
            className="fm-quick-view-reveal col-start-1 row-start-1 min-h-0 overflow-y-auto bg-white p-8 text-center"
          >
            <h2 className="text-lg font-bold">Product unavailable</h2>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              This grocery could not be loaded.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-3 min-h-11 px-4 underline"
            >
              Try again
            </button>
            <Button type="button" onClick={onClose} className="mt-4 min-h-11">
              Close
            </Button>
          </div>
        ) : !loading && presentation ? (
          <div className="fm-quick-view-reveal col-start-1 row-start-1 flex min-h-0 max-h-[min(85dvh,800px)] flex-col overflow-hidden bg-white">
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
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-6 overflow-y-auto overscroll-contain p-5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:p-6">
              <div className="mx-auto w-full max-w-[184px] self-start rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-3 sm:max-w-none">
                <ProductGallery
                  images={view?.images ?? (presentation.media ? [presentation.media] : [])}
                  name={presentation.name}
                />
              </div>
              <div className="min-w-0">
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
                    <span className="text-xs font-normal text-[var(--fm-text-muted)]">
                      Required
                    </span>
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
                          {variant.availability === "OUT_OF_STOCK" ? (
                            "Out of stock"
                          ) : (
                            <ProductPrice variant={variant} />
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {selected?.sale ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sale price is per selling unit.{" "}
                    {selected.sale.remainingQuantity !== null
                      ? `Up to ${selected.sale.remainingQuantity} units remain; your full quantity must fit to get the sale.`
                      : ""}{" "}
                    Cart and checkout confirm current savings.
                  </p>
                ) : null}
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
                          <div
                            aria-hidden="true"
                            className="overflow-hidden rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)]"
                          >
                            <ProductMedia
                              media={product.media}
                              name={product.name}
                              className="rounded-[var(--fm-radius-surface)] p-1"
                            />
                          </div>
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
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--fm-border)] bg-white px-5 py-3 sm:px-6">
              <div className="inline-flex h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)]">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  className="inline-flex size-11 items-center justify-center rounded-l-[var(--fm-radius-control)] transition-transform duration-(--fm-motion-fast) ease-(--fm-ease-out) hover:bg-[var(--fm-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
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
                  className="inline-flex size-11 items-center justify-center rounded-r-[var(--fm-radius-control)] transition-transform duration-(--fm-motion-fast) ease-(--fm-ease-out) hover:bg-[var(--fm-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
              <Button
                type="button"
                onClick={() => void add()}
                disabled={
                  pending ||
                  !selected ||
                  selected.priceMinor === null ||
                  selected.availability !== "AVAILABLE"
                }
                className="h-11 min-w-0 flex-1 px-4 font-bold sm:flex-none sm:px-6"
              >
                {selected?.sale
                  ? "Add to cart · Check current savings"
                  : selected && selected.priceMinor !== null && selected.currency
                    ? `Add to cart · ${formatMoney(selected.priceMinor * quantity, selected.currency)}`
                    : "Add to cart"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
