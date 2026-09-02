"use client";

import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Leaf } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { formatMoney } from "../../lib/storefront/catalog-presentation";
import type { PresentationProduct } from "../../lib/storefront/catalog-presentation";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { AddToCartButton } from "./marketplace/add-to-cart-button";
import { useQuickView } from "./marketplace/quick-view-provider";

/**
 * Canonical product media: Core/D1 provides the asset path and alt text.
 * Unknown or invalid media renders the stable accessible leaf placeholder —
 * Web never guesses an image path from a slug.
 */
export function ProductMedia({
  media,
  name,
  className,
}: {
  media: CatalogMedia | null;
  name: string;
  className?: string;
}) {
  if (media) {
    return (
      <img
        src={media.src}
        alt={media.alt}
        className={cn("aspect-square w-full object-contain", className)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${name} product image`}
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
        className,
      )}
    >
      <Leaf className="size-12 stroke-[1.25]" aria-hidden="true" />
    </div>
  );
}

/**
 * Low-chrome product card: media tile, price, name, and a compact add control
 * in a stable footprint. Variant and availability details remain available in
 * quick view and on the product page. The real href keeps deep links and no-JS
 * navigation working.
 */
export function ProductCard({ product }: { product: PresentationProduct }) {
  const quickView = useQuickView();
  const variant = product.defaultVariant;
  return (
    <article className="group min-w-0">
      <div className="relative overflow-hidden rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)]">
        <Link
          href={`/products/${product.slug}`}
          onClick={(event) => {
            event.preventDefault();
            quickView.openProduct(product.slug);
          }}
          aria-label={`${product.name} details`}
          className="block rounded-[var(--fm-radius-surface)] p-[7px] focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:outline-none"
        >
          <ProductMedia media={product.media} name={product.name} />
        </Link>
        {variant?.availability === "AVAILABLE" ? (
          <div className="absolute right-2 bottom-2">
            <AddToCartButton
              skuId={variant.id}
              productName={product.name}
              unitPriceMinor={variant.priceMinor}
              currency={variant.currency ?? "PHP"}
            />
          </div>
        ) : null}
        {variant?.availability === "OUT_OF_STOCK" ? (
          <span className="absolute right-2 bottom-2 rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-sm">
            Out of stock
          </span>
        ) : null}
      </div>
      <Link
        href={`/products/${product.slug}`}
        onClick={(event) => {
          event.preventDefault();
          quickView.openProduct(product.slug);
        }}
        className="block pt-2 focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:outline-none"
      >
        <h3 className="line-clamp-2 text-base leading-6 font-bold">{product.name}</h3>
        <p className="mt-0.5 text-sm leading-[22px] font-semibold tabular-nums">
          {variant && variant.priceMinor !== null && variant.currency !== null
            ? formatMoney(variant.priceMinor, variant.currency)
            : "Unavailable"}
        </p>
      </Link>
    </article>
  );
}

export function ProductGrid({ products }: { products: ReadonlyArray<PresentationProduct> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function ProductGridEmpty({ query }: { query: string }) {
  return (
    <div className="col-span-full border-y border-[var(--fm-border)] py-16 text-center">
      <Leaf className="mx-auto size-7 text-[var(--fm-text-muted)]" aria-hidden="true" />
      <h3 className="mt-3 font-semibold">No groceries found</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--fm-text-muted)]">
        {query
          ? `No products match “${query}” here. Try another fruit, vegetable, or pantry search.`
          : "This category has no products in the current catalog yet."}
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
      >
        Browse all groceries
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function ProductRail({
  title,
  subtitle,
  href,
  products,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  products: ReadonlyArray<PresentationProduct>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollState = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const maximumScroll = rail.scrollWidth - rail.clientWidth;
    setCanScrollBack(rail.scrollLeft > 1);
    setCanScrollForward(rail.scrollLeft < maximumScroll - 1);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateScrollState();
    rail.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(rail);
    return () => {
      rail.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [products.length, updateScrollState]);

  const moveRail = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({
      left: direction * Math.max(160, rail.clientWidth - 160),
      behavior: "smooth",
    });
  };

  if (products.length === 0) return null;
  return (
    <section aria-labelledby={`rail-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[32px] leading-[42px] font-semibold">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-[var(--fm-text-muted)]">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {href ? (
            <Link
              href={href}
              className="inline-flex min-h-10 items-center px-1 text-sm font-semibold text-[var(--fm-text)] hover:underline"
            >
              See all
            </Link>
          ) : null}
          <button
            type="button"
            aria-label={`Previous ${title} products`}
            disabled={!canScrollBack}
            onClick={() => moveRail(-1)}
            className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--fm-surface-soft)] text-[var(--fm-text)] transition-colors hover:bg-[var(--fm-hover)] disabled:text-[var(--fm-text-subtle)] disabled:opacity-50"
          >
            <ChevronLeft className="size-5" strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Next ${title} products`}
            disabled={!canScrollForward}
            onClick={() => moveRail(1)}
            className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--fm-surface-soft)] text-[var(--fm-text)] transition-colors hover:bg-[var(--fm-hover)] disabled:text-[var(--fm-text-subtle)] disabled:opacity-50"
          >
            <ChevronRight className="size-5" strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={railRef}
        className="fm-scrollbar-none grid auto-cols-[144px] grid-flow-col gap-4 overflow-x-auto pb-2"
      >
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
