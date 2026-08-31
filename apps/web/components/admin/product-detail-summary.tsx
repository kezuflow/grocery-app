import type { AdminProductDetail } from "@freshmarkets/contracts";
import { ImageIcon } from "lucide-react";
import { AdminDashboardGrid, MetricCard } from "./admin-compositions";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function ProductDetailSummary({ product }: { product: AdminProductDetail }) {
  const activeSkus = product.skus.filter((sku) => sku.status === "active");
  const priced = activeSkus.filter((sku) => sku.priceMinor !== null && sku.currency !== null);
  const available = activeSkus.filter((sku) => sku.availability === "AVAILABLE");
  const prices = priced.map((sku) => sku.priceMinor!).sort((left, right) => left - right);
  const minimum = prices[0];
  const maximum = prices.at(-1);
  const priceValue =
    minimum === undefined || maximum === undefined
      ? null
      : minimum === maximum
        ? money(minimum, product.pricingContext.currency)
        : `${money(minimum, product.pricingContext.currency)}–${money(maximum, product.pricingContext.currency)}`;
  const primary = product.media.find((media) => media.isPrimary) ?? product.media[0] ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.5fr)]">
      <section
        aria-label="Product media preview"
        className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-muted)] p-3 shadow-[var(--fm-shadow-card)]"
      >
        {primary ? (
          <img
            alt={primary.altText}
            className="aspect-square w-full rounded-lg object-cover"
            height={640}
            src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(primary.mediaId)}/content?v=${primary.version}`}
            width={640}
          />
        ) : (
          <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-[var(--fm-border)] bg-white text-[var(--fm-text-muted)]">
            <span className="grid justify-items-center gap-2 text-sm">
              <ImageIcon className="size-6" aria-hidden /> No primary media
            </span>
          </div>
        )}
        {product.media.length > 1 ? (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {product.media.slice(0, 5).map((media) => (
              <img
                alt={media.altText}
                className="aspect-square w-full rounded-md border border-[var(--fm-border)] object-cover"
                height={96}
                key={media.mediaId}
                loading="lazy"
                src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(media.mediaId)}/content?v=${media.version}`}
                width={96}
              />
            ))}
          </div>
        ) : null}
      </section>

      <AdminDashboardGrid ariaLabel="Product readiness" className="content-start sm:grid-cols-2">
        <MetricCard
          className="xl:col-span-1"
          label="Resolved price"
          value={priceValue}
          unavailableReason="No active SKU has a valid price in this context."
        />
        <MetricCard
          className="xl:col-span-1"
          label="Active SKUs"
          value={String(activeSkus.length)}
        />
        <MetricCard
          className="xl:col-span-1"
          label="Priced SKUs"
          value={`${priced.length} / ${activeSkus.length}`}
        />
        <MetricCard
          className="xl:col-span-1"
          label="Available SKUs"
          value={`${available.length} / ${activeSkus.length}`}
        />
      </AdminDashboardGrid>
    </div>
  );
}
