import type { AdminProductDetail } from "@freshmarkets/contracts";
import { ExternalLink, ImageIcon, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { Button } from "../ui/button";
import { AdminStatusPill } from "./admin-status-pill";

function money(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || currency === null) return "Price unavailable";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function mediaUrl(product: AdminProductDetail): string | null {
  const primary = product.media.find((media) => media.isPrimary) ?? product.media[0];
  if (!primary) return null;
  const location =
    product.scope.kind === "LOCATION"
      ? `&locationId=${encodeURIComponent(product.scope.locationId)}`
      : "";
  return `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(primary.mediaId)}/content?v=${primary.version}${location}`;
}

export function ProductPreviewPanel({
  product,
  fromQuery,
  onClose,
}: {
  product: AdminProductDetail;
  fromQuery: string;
  onClose: () => void;
}) {
  const image = mediaUrl(product);
  const detailHref = `/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`;
  const editHref = `/admin/catalog/products/${product.productId}/edit${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`;
  const latestRecordedChange = product.recentAudit
    .map((event) => event.occurredAt)
    .sort()
    .at(-1);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Product preview
          </p>
          <h2
            id="product-panel-title"
            className="mt-1 truncate text-xl font-bold tracking-[-0.03em]"
          >
            {product.name}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close product preview"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section className="flex items-center gap-4" aria-label="Product identity">
          {image ? (
            <img
              src={image}
              alt=""
              className="size-24 shrink-0 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] object-cover"
            />
          ) : (
            <span className="grid size-24 shrink-0 place-items-center rounded-lg border border-dashed border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] text-[var(--fm-text-muted)]">
              <ImageIcon className="size-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold">{product.name}</h3>
            <p className="mt-1 truncate text-sm text-[var(--fm-text-muted)]">
              {product.categoryName}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--fm-text-muted)]">{product.slug}</p>
          </div>
        </section>

        <section
          className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--fm-border)] pt-5"
          aria-labelledby="product-preview-status"
        >
          <h3 id="product-preview-status" className="text-sm font-semibold">
            Status
          </h3>
          <AdminStatusPill
            status={product.status}
            tone={product.status === "active" ? "success" : "danger"}
            label={product.status.charAt(0).toUpperCase() + product.status.slice(1)}
          />
        </section>

        <section
          className="mt-6 border-t border-[var(--fm-border)] pt-5"
          aria-labelledby="product-preview-options"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="product-preview-options" className="text-sm font-semibold">
                Selling options
              </h3>
              <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                Different weights, packs, or variants for this product.
              </p>
            </div>
            <span className="shrink-0 text-sm text-[var(--fm-text-muted)]">
              {product.skus.length} option{product.skus.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-[var(--fm-border)]">
            {product.skus.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No selling options yet.</p>
            ) : (
              product.skus.map((sku) => (
                <article
                  key={sku.skuId}
                  className="flex items-center gap-3 border-b border-[var(--fm-border)] p-3 last:border-b-0"
                >
                  {image ? (
                    <img
                      src={image}
                      alt=""
                      className="size-12 shrink-0 rounded-md border border-[var(--fm-border)] object-cover"
                    />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-md bg-[var(--fm-admin-surface-muted)]">
                      <ImageIcon
                        className="size-4 text-[var(--fm-text-muted)]"
                        aria-hidden="true"
                      />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{sku.name}</p>
                    <p className="mt-0.5 text-sm font-semibold">
                      {money(sku.priceMinor, sku.currency)}
                    </p>
                  </div>
                  <AdminStatusPill
                    status={sku.status}
                    tone={sku.status === "active" ? "success" : "neutral"}
                    label={sku.status.charAt(0).toUpperCase() + sku.status.slice(1)}
                  />
                </article>
              ))
            )}
          </div>
          {product.allowedActions.includes("UPDATE") ? (
            <Button
              asChild
              variant="outline"
              className="mt-2 w-full justify-start text-[var(--fm-admin-accent-strong)]"
            >
              <Link href={`${detailHref}#product-variants`} prefetch={false}>
                <Plus aria-hidden="true" />
                Add selling option
              </Link>
            </Button>
          ) : null}
        </section>

        <section
          className="mt-6 border-t border-[var(--fm-border)] pt-5"
          aria-label="Product metadata"
        >
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-[var(--fm-text-muted)]">Category</dt>
            <dd className="font-medium">{product.categoryName}</dd>
            <dt className="text-[var(--fm-text-muted)]">Inventory unit</dt>
            <dd className="font-medium">{product.inventoryPool.baseUnitSymbol}</dd>
            <dt className="text-[var(--fm-text-muted)]">Catalog version</dt>
            <dd>{product.version}</dd>
            <dt className="text-[var(--fm-text-muted)]">Last recorded change</dt>
            <dd>{date(latestRecordedChange ?? null)}</dd>
          </dl>
        </section>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button asChild variant="outline">
          <Link href={detailHref} prefetch={false}>
            <ExternalLink aria-hidden="true" />
            View product
          </Link>
        </Button>
        {product.allowedActions.includes("UPDATE") ? (
          <Button asChild>
            <Link href={editHref} prefetch={false}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </>
  );
}
