"use client";

import type { AdminProductPage } from "@freshmarkets/contracts";
import { Columns3, ImageIcon, ListFilter, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AdminDashboardGrid, MetricCard } from "./admin-compositions";
import { ConfirmCommandDialog } from "./admin-controls";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type ProductListItem = AdminProductPage["items"][number];

type ProductColumnKey = "category" | "price" | "variant" | "selling" | "inventory" | "status";

const PRODUCT_COLUMN_OPTIONS: ReadonlyArray<{ key: ProductColumnKey; label: string }> = [
  { key: "category", label: "Category" },
  { key: "price", label: "Resolved price" },
  { key: "variant", label: "Variant readiness" },
  { key: "selling", label: "Selling status" },
  { key: "inventory", label: "Shared inventory" },
  { key: "status", label: "Catalog status" },
];

export type BulkProductSelection = Pick<ProductListItem, "productId" | "name" | "version"> & {
  idempotencyKey: string;
};

export type BulkProductDeactivationResult = {
  succeeded: ReadonlyArray<{ productId: string; name: string }>;
  failed: ReadonlyArray<{
    productId: string;
    name: string;
    message: string;
    requestId: string | null;
  }>;
};

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
  canManage = false,
  deactivationPending = false,
  onDeactivateSelected,
  filters,
  activeFilterCount = 0,
}: {
  page: AdminProductPage;
  fromQuery: string;
  canManage?: boolean;
  deactivationPending?: boolean;
  onDeactivateSelected?: (
    products: ReadonlyArray<BulkProductSelection>,
    reason: string,
  ) => Promise<BulkProductDeactivationResult>;
  filters?: ReactNode;
  activeFilterCount?: number;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const [result, setResult] = useState<BulkProductDeactivationResult | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<ReadonlySet<ProductColumnKey>>(
    () => new Set(PRODUCT_COLUMN_OPTIONS.map((column) => column.key)),
  );
  const selectionKeys = useRef(new Map<string, string>());
  const deactivateTrigger = useRef<HTMLButtonElement>(null);
  const selectableProducts = page.items.filter((product) => product.status === "active");
  const selectedProducts = page.items.filter((product) => selectedIds.has(product.productId));
  const allSelected =
    selectableProducts.length > 0 && selectedIds.size === selectableProducts.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const locationOperations = page.viewMode === "LOCATION_OPERATIONS";
  const columnOptions = locationOperations
    ? PRODUCT_COLUMN_OPTIONS
    : PRODUCT_COLUMN_OPTIONS.filter(
        (column) => column.key !== "selling" && column.key !== "inventory",
      );

  useEffect(() => {
    const currentSelectable = new Set(selectableProducts.map((product) => product.productId));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((productId) => currentSelectable.has(productId)));
      const unchanged =
        next.size === current.size && [...next].every((productId) => current.has(productId));
      return unchanged ? current : next;
    });
    for (const productId of selectionKeys.current.keys()) {
      if (!currentSelectable.has(productId)) selectionKeys.current.delete(productId);
    }
  }, [page.items]);

  function selectProduct(productId: string, checked: boolean) {
    setResult(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(productId);
        if (!selectionKeys.current.has(productId)) {
          selectionKeys.current.set(productId, crypto.randomUUID());
        }
      } else {
        next.delete(productId);
        selectionKeys.current.delete(productId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    selectionKeys.current.clear();
    setConfirmingDeactivation(false);
  }

  function setColumnVisible(column: ProductColumnKey, visible: boolean) {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (visible) next.add(column);
      else next.delete(column);
      return next;
    });
  }

  async function deactivateSelected(reason: string) {
    if (!onDeactivateSelected || selectedProducts.length === 0) return;
    setConfirmingDeactivation(false);
    const outcome = await onDeactivateSelected(
      selectedProducts.map((product) => ({
        productId: product.productId,
        name: product.name,
        version: product.version,
        idempotencyKey: selectionKeys.current.get(product.productId) ?? crypto.randomUUID(),
      })),
      reason,
    );
    setResult(outcome);
    clearSelection();
  }

  const readiness = [
    ["Active products", page.readiness.activeProducts],
    ["Inactive products", page.readiness.inactiveProducts],
    ["Missing primary media", page.readiness.missingPrimaryMedia],
    ["Missing prices", page.readiness.missingPrices],
    page.viewMode === "LOCATION_OPERATIONS"
      ? (["Variants not selling", page.readiness.unavailableSkus] as const)
      : (["Location selling status", "Choose Central Cebu"] as const),
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
        {selectedIds.size > 0 ? (
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" role="status" aria-live="polite">
                {selectedIds.size} selected
              </span>
              <Button
                ref={deactivateTrigger}
                type="button"
                size="sm"
                variant="destructive"
                disabled={deactivationPending || !onDeactivateSelected}
                onClick={() => setConfirmingDeactivation(true)}
              >
                <Trash2 aria-hidden="true" />
                Deactivate
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={deactivationPending}
              onClick={clearSelection}
            >
              <X aria-hidden="true" />
              Cancel
            </Button>
          </div>
        ) : (
          <div
            role="toolbar"
            aria-label="Product table controls"
            className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-2.5"
          >
            {filters ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    <ListFilter aria-hidden="true" />
                    Filters
                    {activeFilterCount > 0 ? (
                      <span className="rounded-full bg-[var(--fm-admin-accent-soft)] px-1.5 text-xs text-[var(--fm-admin-accent-strong)]">
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 border-[var(--fm-border)] bg-white p-3 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
                >
                  <div className="grid gap-3">{filters}</div>
                </PopoverContent>
              </Popover>
            ) : (
              <span />
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <Columns3 aria-hidden="true" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 border-[var(--fm-border)] bg-white p-2 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"
              >
                <p className="px-2 pb-1.5 text-xs font-medium text-[var(--fm-text-muted)]">
                  Show columns
                </p>
                <div className="grid gap-0.5">
                  {columnOptions.map((column) => (
                    <label
                      key={column.key}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-[var(--fm-hover)]"
                    >
                      <Checkbox
                        aria-label={`Toggle ${column.label} column`}
                        checked={visibleColumns.has(column.key)}
                        onCheckedChange={(checked) =>
                          setColumnVisible(column.key, checked === true)
                        }
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {result ? (
          result.failed.length > 0 ? (
            <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
              <AlertTitle>Bulk deactivation finished with exceptions</AlertTitle>
              <AlertDescription>
                <p>
                  {result.succeeded.length} deactivated; {result.failed.length} failed.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {result.failed.map((failure) => (
                    <li key={failure.productId}>
                      {failure.name}: {failure.message}
                      {failure.requestId ? ` (request ${failure.requestId})` : ""}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <p className="border-b border-[var(--fm-border)] px-4 py-3 text-sm" role="status">
              {result.succeeded.length} product{result.succeeded.length === 1 ? "" : "s"}{" "}
              deactivated.
            </p>
          )
        ) : null}
        <div className="overflow-x-auto">
          <Table aria-label="Products">
            <TableHeader>
              <TableRow>
                {canManage ? (
                  <TableHead className="w-12">
                    <Checkbox
                      aria-label="Select all active products"
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      disabled={selectableProducts.length === 0 || deactivationPending}
                      onCheckedChange={(checked) => {
                        setResult(null);
                        if (checked === true) {
                          for (const product of selectableProducts) {
                            if (!selectionKeys.current.has(product.productId)) {
                              selectionKeys.current.set(product.productId, crypto.randomUUID());
                            }
                          }
                          setSelectedIds(
                            new Set(selectableProducts.map((product) => product.productId)),
                          );
                        } else {
                          clearSelection();
                        }
                      }}
                    />
                  </TableHead>
                ) : null}
                <TableHead>Product</TableHead>
                {visibleColumns.has("category") ? <TableHead>Category</TableHead> : null}
                {visibleColumns.has("price") ? <TableHead>Resolved price</TableHead> : null}
                {visibleColumns.has("variant") ? <TableHead>Variant readiness</TableHead> : null}
                {locationOperations && visibleColumns.has("selling") ? (
                  <TableHead>Selling status</TableHead>
                ) : null}
                {locationOperations && visibleColumns.has("inventory") ? (
                  <TableHead>Shared inventory</TableHead>
                ) : null}
                {visibleColumns.has("status") ? <TableHead>Catalog status</TableHead> : null}
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((product) => (
                <TableRow
                  key={product.productId}
                  data-state={selectedIds.has(product.productId) ? "selected" : undefined}
                >
                  {canManage ? (
                    <TableCell className="w-12">
                      <Checkbox
                        aria-label={`Select ${product.name}`}
                        checked={selectedIds.has(product.productId)}
                        disabled={product.status !== "active" || deactivationPending}
                        onCheckedChange={(checked) =>
                          selectProduct(product.productId, checked === true)
                        }
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="min-w-64">
                    <div className="flex items-center gap-3">
                      {product.primaryMedia ? (
                        <img
                          alt={product.primaryMedia.altText}
                          className="size-11 rounded-md border border-[var(--fm-border)] object-cover"
                          height={44}
                          loading="lazy"
                          src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(product.primaryMedia.mediaId)}/content?v=${product.primaryMedia.version}${page.pricingContext.locationId ? `&locationId=${encodeURIComponent(page.pricingContext.locationId)}` : ""}`}
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
                  {visibleColumns.has("category") ? (
                    <TableCell>{product.categoryCode}</TableCell>
                  ) : null}
                  {visibleColumns.has("price") ? (
                    <TableCell>
                      <span
                        className={
                          product.priceRange ? "font-medium" : "text-[var(--fm-text-muted)]"
                        }
                      >
                        {priceRange(product)}
                      </span>
                    </TableCell>
                  ) : null}
                  {visibleColumns.has("variant") ? (
                    <TableCell>
                      <span className="font-medium">
                        {product.pricedSkuCount} / {product.activeSkuCount}
                      </span>
                      <span className="block text-xs text-[var(--fm-text-muted)]">
                        active variants priced
                      </span>
                    </TableCell>
                  ) : null}
                  {locationOperations && visibleColumns.has("selling") ? (
                    <TableCell>
                      <span className="font-medium">
                        {product.availableSkuCount} / {product.activeSkuCount} selling
                      </span>
                    </TableCell>
                  ) : null}
                  {locationOperations && visibleColumns.has("inventory") ? (
                    <TableCell>
                      {product.inventoryPosition ? (
                        <>
                          <span className="font-medium">
                            {product.inventoryPosition.availableBase.toLocaleString()} available
                          </span>
                          <span className="block text-xs text-[var(--fm-text-muted)]">
                            {product.inventoryPosition.onHandBase.toLocaleString()} on hand ·{" "}
                            {product.inventoryPosition.reservedBase.toLocaleString()} reserved
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--fm-text-muted)]">No stock recorded</span>
                      )}
                    </TableCell>
                  ) : null}
                  {visibleColumns.has("status") ? (
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
                  ) : null}
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
      <ConfirmCommandDialog
        open={confirmingDeactivation}
        title={`Deactivate ${selectedIds.size} product${selectedIds.size === 1 ? "" : "s"}?`}
        resource={selectedProducts.map((product) => product.name).join(", ")}
        scope="Global Catalog"
        consequence="Selected Products leave storefront availability. Variants, prices, inventory history, and committed order snapshots remain intact."
        confirmLabel="Confirm deactivation"
        cancelLabel="Cancel"
        pending={deactivationPending}
        restoreFocusRef={deactivateTrigger}
        onCancel={() => setConfirmingDeactivation(false)}
        onConfirm={(reason) => void deactivateSelected(reason)}
      />
    </div>
  );
}
