import type { AdminProductPage } from "@freshmarkets/contracts";
import { ImageIcon } from "lucide-react";
import { AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { Badge } from "../ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function priceRange(product: AdminProductPage["items"][number]) {
  if (!product.priceRange) return "Price unavailable";
  const minimum = money(product.priceRange.minimumMinor, product.priceRange.currency);
  const maximum = money(product.priceRange.maximumMinor, product.priceRange.currency);
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}

export function ProductListView({
  page,
  fromQuery,
}: {
  page: AdminProductPage;
  fromQuery: string;
}) {
  const readiness = [
    ["Active products", page.readiness.activeProducts],
    ["Inactive products", page.readiness.inactiveProducts],
    ["Missing primary media", page.readiness.missingPrimaryMedia],
    ["Missing prices", page.readiness.missingPrices],
    ["Unavailable SKUs", page.readiness.unavailableSkus],
  ] as const;
  return (
    <div className="space-y-4">
      <h2 className="sr-only">Catalog readiness</h2>
      <AdminDashboardGrid ariaLabel="Catalog readiness" className="sm:grid-cols-2 xl:grid-cols-5">
        {readiness.map(([label, value]) => (
          <MetricCard className="xl:col-span-1" key={label} label={label} value={String(value)} />
        ))}
      </AdminDashboardGrid>

      <section className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white shadow-[var(--fm-shadow-card)]">
        <div className="overflow-x-auto">
          <Table aria-label="Products">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Resolved price</TableHead>
                <TableHead>SKU readiness</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((product) => (
                <TableRow key={product.productId}>
                  <TableCell className="min-w-64">
                    <div className="flex items-center gap-3">
                      {product.primaryMedia ? (
                        <img
                          alt={product.primaryMedia.altText}
                          className="size-11 rounded-md border border-[var(--fm-border)] object-cover"
                          height={44}
                          loading="lazy"
                          src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(product.primaryMedia.mediaId)}/content?v=${product.primaryMedia.version}`}
                          width={44}
                        />
                      ) : (
                        <span className="grid size-11 place-items-center rounded-md border border-dashed border-[var(--fm-border)] bg-[var(--fm-surface-muted)]">
                          <ImageIcon className="size-4 text-[var(--fm-text-muted)]" aria-hidden />
                        </span>
                      )}
                      <span>
                        <span className="block font-medium">{product.name}</span>
                        <span className="block text-xs text-[var(--fm-text-muted)]">
                          {product.slug}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{product.categoryCode}</TableCell>
                  <TableCell>
                    <span
                      className={product.priceRange ? "font-medium" : "text-[var(--fm-text-muted)]"}
                    >
                      {priceRange(product)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {product.pricedSkuCount} / {product.activeSkuCount}
                    </span>
                    <span className="block text-xs text-[var(--fm-text-muted)]">
                      active SKUs priced
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {product.availableSkuCount} / {product.activeSkuCount} available
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        product.status === "active"
                          ? "border-[var(--fm-success-border)] bg-[var(--fm-success-soft)]"
                          : undefined
                      }
                      variant="secondary"
                    >
                      {product.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <a
                      className="font-medium text-[var(--fm-admin-accent-strong)] hover:underline"
                      href={`/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`}
                    >
                      View
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {page.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--fm-text-muted)]" role="status">
            No products match the current filters.
          </p>
        ) : null}
      </section>
    </div>
  );
}
