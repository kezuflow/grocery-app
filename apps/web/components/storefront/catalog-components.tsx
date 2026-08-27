"use client";

import Link from "next/link";
import { ArrowRight, Leaf } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatMoney } from "../../lib/storefront/catalog-presentation";
import type { PresentationProduct } from "../../lib/storefront/catalog-presentation";
import { AddToCartButton } from "./marketplace/add-to-cart-button";
import { useQuickView } from "./marketplace/quick-view-provider";

/**
 * Canonical product media: resolved produce image or the stable leaf
 * placeholder until the R2 canonical-media boundary lands.
 */
export function ProductMedia({
  image,
  name,
  className,
}: {
  image: string | null;
  name: string;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt={`${name} product image`}
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
 * Low-chrome product card: media tile, price, name, fixed variant, and
 * availability with a compact add control in a stable footprint. The card
 * opens the quick-view overlay without losing browse position; the real href
 * keeps deep links and no-JS navigation working.
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
          className="block rounded-[var(--fm-radius-surface)] focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:outline-none"
        >
          <ProductMedia image={product.image} name={product.name} />
        </Link>
        {variant ? (
          <div className="absolute right-2 bottom-2">
            <AddToCartButton
              skuId={variant.id}
              productName={product.name}
              unitPriceMinor={variant.priceMinor}
              currency={variant.currency ?? "PHP"}
            />
          </div>
        ) : null}
      </div>
      <Link
        href={`/products/${product.slug}`}
        onClick={(event) => {
          event.preventDefault();
          quickView.openProduct(product.slug);
        }}
        className="block pt-3 focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:outline-none"
      >
        <p className="text-base font-bold tabular-nums">
          {variant && variant.priceMinor !== null && variant.currency !== null
            ? formatMoney(variant.priceMinor, variant.currency)
            : "Unavailable"}
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5">{product.name}</h3>
        <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">
          {variant ? `${variant.label} · fixed pack` : "Fixed variant unavailable"}
        </p>
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-xs font-medium",
            product.available ? "text-[var(--fm-success)]" : "text-[var(--fm-destructive)]",
          )}
        >
          <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden="true" />
          {product.available ? "Available for delivery" : "Currently unavailable"}
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
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={`rail-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-[var(--fm-text-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="shrink-0 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--fm-primary-dark)] hover:underline"
          >
            See all
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="fm-scrollbar-none grid auto-cols-[minmax(150px,190px)] grid-flow-col gap-4 overflow-x-auto pb-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
