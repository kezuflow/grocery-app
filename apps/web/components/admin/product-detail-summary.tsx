import type { AdminProductDetail } from "@freshmarkets/contracts";
import { Boxes, ImageIcon, Tag } from "lucide-react";
import { AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { Badge } from "../ui/badge";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function ProductDetailSummary({ product }: { product: AdminProductDetail }) {
  const locationScope = product.scope.kind === "LOCATION" ? product.scope : null;
  const activeSkus = product.skus.filter((sku) => sku.status === "active");
  const priced = activeSkus.filter((sku) => sku.priceMinor !== null && sku.currency !== null);
  const prices = priced.map((sku) => sku.priceMinor!).sort((left, right) => left - right);
  const minimum = prices[0];
  const maximum = prices.at(-1);
  const priceValue =
    minimum === undefined || maximum === undefined
      ? null
      : !locationScope
        ? null
        : minimum === maximum
          ? money(minimum, locationScope.currency)
          : `${money(minimum, locationScope.currency)}–${money(maximum, locationScope.currency)}`;
  const primary = product.media.find((media) => media.isPrimary) ?? product.media[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="grid overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)] lg:grid-cols-[minmax(20rem,0.82fr)_minmax(0,1.18fr)]">
        <section
          aria-label="Product media preview"
          className="border-b border-[var(--fm-border)] bg-[var(--fm-surface-muted)] p-4 lg:border-r lg:border-b-0"
        >
          {primary ? (
            <img
              alt={primary.altText}
              className="aspect-square w-full rounded-xl border border-[var(--fm-border)] bg-white object-cover"
              height={640}
              src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(primary.mediaId)}/content?v=${primary.version}${locationScope ? `&locationId=${encodeURIComponent(locationScope.locationId)}` : ""}`}
              width={640}
            />
          ) : (
            <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-[var(--fm-border)] bg-white text-[var(--fm-text-muted)]">
              <span className="grid justify-items-center gap-2 text-sm">
                <ImageIcon className="size-7" aria-hidden /> No primary media
              </span>
            </div>
          )}
          {product.media.length > 1 ? (
            <div className="mt-3 grid grid-cols-5 gap-2" aria-label="Product media thumbnails">
              {product.media.slice(0, 5).map((media) => (
                <img
                  alt={media.altText}
                  className={`aspect-square w-full rounded-lg border object-cover ${
                    media.mediaId === primary?.mediaId
                      ? "border-[var(--fm-admin-accent)] ring-2 ring-[var(--fm-admin-accent-soft)]"
                      : "border-[var(--fm-border)]"
                  }`}
                  height={96}
                  key={media.mediaId}
                  loading="lazy"
                  src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(media.mediaId)}/content?v=${media.version}${locationScope ? `&locationId=${encodeURIComponent(locationScope.locationId)}` : ""}`}
                  width={96}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="product-overview-heading" className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-[var(--fm-admin-accent-strong)] uppercase">
                Product overview
              </p>
              <h2 id="product-overview-heading" className="mt-1 text-lg font-semibold">
                {product.name}
              </h2>
            </div>
            <Badge
              className={
                product.status === "active"
                  ? "border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] text-[var(--fm-success)]"
                  : undefined
              }
              variant="secondary"
            >
              {product.status}
            </Badge>
          </div>

          <div className="mt-5 border-t border-[var(--fm-border)] pt-5">
            <h3 className="text-sm font-semibold">Description</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--fm-text-muted)]">
              {product.description ?? "No customer-facing description has been provided."}
            </p>
          </div>

          {product.customerDetails.length ? (
            <div className="mt-5 border-t border-[var(--fm-border)] pt-5">
              <h3 className="text-sm font-semibold">Customer details</h3>
              <dl className="mt-3 divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
                {product.customerDetails.map((detail) => (
                  <div
                    className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
                    key={detail.detailId}
                  >
                    <dt className="font-medium text-[var(--fm-text-muted)]">{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="mt-5 border-t border-[var(--fm-border)] pt-5">
            <h3 className="text-sm font-semibold">Catalog facts</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 gap-2 rounded-lg bg-[var(--fm-surface-muted)] p-3">
                <Tag className="mt-0.5 size-4 shrink-0 text-[var(--fm-text-muted)]" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--fm-text-muted)]">Category</dt>
                  <dd className="truncate text-sm font-medium">{product.categoryName}</dd>
                </div>
              </div>
              <div className="flex min-w-0 gap-2 rounded-lg bg-[var(--fm-surface-muted)] p-3">
                <Boxes className="mt-0.5 size-4 shrink-0 text-[var(--fm-text-muted)]" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--fm-text-muted)]">Inventory base unit</dt>
                  <dd className="truncate text-sm font-medium">
                    {product.inventoryPool.baseUnitCode} ({product.inventoryPool.baseUnitSymbol})
                  </dd>
                </div>
              </div>
            </dl>
          </div>
        </section>
      </div>

      <AdminDashboardGrid ariaLabel="Product readiness" className="sm:grid-cols-2 xl:grid-cols-4">
        {locationScope ? (
          <MetricCard
            className="xl:col-span-1"
            label={`${locationScope.locationName} price`}
            value={priceValue}
            unavailableReason="No active variant has an exact price at this location."
          />
        ) : null}
        <MetricCard
          className="xl:col-span-1"
          label="Active variants"
          value={String(activeSkus.length)}
        />
        {locationScope ? (
          <MetricCard
            className="xl:col-span-1"
            label="Priced variants"
            value={`${priced.length} / ${activeSkus.length}`}
          />
        ) : (
          <MetricCard
            className="xl:col-span-1"
            label="Media assets"
            value={String(product.media.length)}
          />
        )}
        {locationScope ? (
          <MetricCard
            className="xl:col-span-1"
            label="Shared inventory available"
            value={
              product.inventoryPool.position
                ? `${product.inventoryPool.position.availableBase.toLocaleString()} ${product.inventoryPool.baseUnitSymbol}`
                : null
            }
            unavailableReason="No stock balance has been recorded for this Product at this location."
          />
        ) : null}
      </AdminDashboardGrid>
    </div>
  );
}
