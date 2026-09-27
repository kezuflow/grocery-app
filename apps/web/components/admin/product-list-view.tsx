"use client";

import type { AdminProductPage } from "@freshmarkets/contracts";
import {
  Clipboard,
  Columns3,
  EllipsisVertical,
  Eye,
  ImageIcon,
  ListFilter,
  Pencil,
  PowerOff,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { notifyCommandError, notifyCommandSuccess } from "./admin-feedback";
import { AdminStatusPill } from "./admin-status-pill";
import { AdminIndexViews, ConfirmCommandDialog } from "./admin-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";
import { Badge } from "@/components/admin/shadcn/badge";
import { Button } from "@/components/admin/shadcn/button";
import { Checkbox } from "@/components/admin/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/admin/shadcn/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/admin/shadcn/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/shadcn/table";

type ProductListItem = AdminProductPage["items"][number];

type ProductColumnKey = "category" | "price" | "variant" | "selling" | "status";

type ProductStatusView = "all" | "active" | "inactive";

const PRODUCT_STATUS_VIEWS: ReadonlyArray<{ label: string; status: ProductStatusView }> = [
  { label: "All", status: "all" },
  { label: "Active", status: "active" },
  { label: "Inactive", status: "inactive" },
];

const PRODUCT_COLUMN_OPTIONS: ReadonlyArray<{ key: ProductColumnKey; label: string }> = [
  { key: "category", label: "Category" },
  { key: "price", label: "Location price" },
  { key: "variant", label: "Variants" },
  { key: "selling", label: "Selling status" },
  { key: "status", label: "Status" },
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
  deactivationRecoveryVersion = 0,
  onDeactivateSelected,
  onOpenProduct,
  openProductId,
  detailPanelId,
  status,
  onStatusChange,
  filters,
  activeFilterCount = 0,
}: {
  page: AdminProductPage;
  fromQuery: string;
  canManage?: boolean;
  deactivationPending?: boolean;
  deactivationRecoveryVersion?: number;
  onDeactivateSelected?: (
    products: ReadonlyArray<BulkProductSelection>,
    reason: string,
  ) => Promise<BulkProductDeactivationResult>;
  onOpenProduct?: (product: ProductListItem) => void;
  openProductId?: string | null;
  detailPanelId?: string;
  status: ProductStatusView;
  onStatusChange(status: ProductStatusView): void;
  filters?: ReactNode;
  activeFilterCount?: number;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const [rowToDeactivate, setRowToDeactivate] = useState<ProductListItem | null>(null);
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [result, setResult] = useState<BulkProductDeactivationResult | null>(null);
  useEffect(() => setResult(null), [deactivationRecoveryVersion]);
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
  const locationScope = page.scope.kind === "LOCATION" ? page.scope : null;
  const locationOperations = locationScope !== null;
  const columnOptions = locationOperations
    ? PRODUCT_COLUMN_OPTIONS
    : PRODUCT_COLUMN_OPTIONS.filter((column) => !["price", "selling"].includes(column.key));

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
    if (outcome.failed.length > 0) {
      setResult(outcome);
    } else {
      notifyCommandSuccess(
        "Products deactivated",
        `${outcome.succeeded.length} product${outcome.succeeded.length === 1 ? "" : "s"} left storefront availability.`,
      );
    }
    clearSelection();
  }

  async function deactivateProduct(product: ProductListItem, reason: string) {
    if (!onDeactivateSelected) return;
    setRowToDeactivate(null);
    const outcome = await onDeactivateSelected(
      [
        {
          productId: product.productId,
          name: product.name,
          version: product.version,
          idempotencyKey: crypto.randomUUID(),
        },
      ],
      reason,
    );
    if (outcome.failed.length > 0) {
      setResult(outcome);
    } else {
      notifyCommandSuccess("Product deactivated", `${product.name} left storefront availability.`);
    }
  }

  async function copyProductId(productId: string) {
    try {
      await navigator.clipboard.writeText(productId);
      setCopiedProductId(productId);
      window.setTimeout(() => {
        setCopiedProductId((current) => (current === productId ? null : current));
      }, 2_000);
    } catch {
      notifyCommandError("Copy failed", "The product ID could not be written to the clipboard.");
    }
  }

  const readiness = locationOperations
    ? ([
        ["Active", page.readiness.activeProducts],
        ["Inactive", page.readiness.inactiveProducts],
        ["Missing Media", page.readiness.missingPrimaryMedia],
        ["Missing location prices", page.readiness.missingPrices],
        ["Variants not selling", page.readiness.unavailableSkus],
      ] as const)
    : ([
        ["Active", page.readiness.activeProducts],
        ["Inactive", page.readiness.inactiveProducts],
        ["Missing Media", page.readiness.missingPrimaryMedia],
      ] as const);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <AdminIndexViews
          label="Product status views"
          views={PRODUCT_STATUS_VIEWS}
          value={status}
          onChange={onStatusChange}
        />
        <dl aria-label="Catalog readiness" className="flex flex-wrap gap-x-6 gap-y-2">
          {readiness.map(([label, value]) => (
            <div className="flex items-baseline gap-1.5 whitespace-nowrap" key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <section className="overflow-hidden rounded-md border border-border">
        <h2 className="sr-only">Product list</h2>
        {locationScope ? (
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{locationScope.locationName} pricing</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {locationScope.locationName} owns the exact prices shown here. Product identity
              remains Global; exact inventory quantities stay in each scoped Product preview.
            </p>
          </div>
        ) : null}
        {selectedIds.size > 0 ? (
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
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
            className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-2.5"
          >
            {filters ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    <ListFilter aria-hidden="true" />
                    Filters
                    {activeFilterCount > 0 ? (
                      <Badge variant="secondary">{activeFilterCount}</Badge>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 border-border bg-card p-3 text-foreground shadow-md"
                >
                  <div className="grid gap-3">{filters}</div>
                </PopoverContent>
              </Popover>
            ) : (
              <span />
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="hidden md:inline-flex">
                  <Columns3 aria-hidden="true" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 border-border bg-card p-2 text-foreground shadow-md"
              >
                <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
                  Show columns
                </p>
                <div className="grid gap-0.5">
                  {columnOptions.map((column) => (
                    <label
                      key={column.key}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-accent"
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
        ) : null}
        <div className="space-y-3 p-3 md:hidden">
          {page.items.map((product) => (
            <article
              key={product.productId}
              data-product-record={product.productId}
              data-preview-open={openProductId === product.productId ? "true" : undefined}
              data-state={selectedIds.has(product.productId) ? "selected" : undefined}
              className={`rounded-md border border-border bg-card p-3 ${
                openProductId === product.productId ? "border-primary bg-secondary" : ""
              }`}
              onClick={(event) => {
                if (!onOpenProduct) return;
                const target = event.target;
                if (
                  target instanceof Element &&
                  target.closest(
                    "button, a, input, select, textarea, [role='checkbox'], [role='menuitem']",
                  )
                )
                  return;
                onOpenProduct(product);
              }}
            >
              <div className="flex items-start gap-3">
                {canManage ? (
                  <Checkbox
                    aria-label={`Select ${product.name}`}
                    checked={selectedIds.has(product.productId)}
                    disabled={product.status !== "active" || deactivationPending}
                    onCheckedChange={(checked) =>
                      selectProduct(product.productId, checked === true)
                    }
                  />
                ) : null}
                {product.primaryMedia ? (
                  <img
                    alt={product.primaryMedia.altText}
                    className="size-11 shrink-0 rounded-md border border-border object-cover"
                    height={44}
                    loading="lazy"
                    src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(product.primaryMedia.mediaId)}/content?v=${product.primaryMedia.version}${locationScope ? `&locationId=${encodeURIComponent(locationScope.locationId)}` : ""}`}
                    width={44}
                  />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md border border-dashed border-border bg-muted">
                    <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {onOpenProduct ? (
                    <button
                      type="button"
                      aria-label={`Preview ${product.name}`}
                      aria-expanded={openProductId === product.productId}
                      aria-controls={detailPanelId}
                      className="block max-w-full truncate text-left font-medium hover:underline"
                      onClick={() => onOpenProduct(product)}
                    >
                      {product.name}
                    </button>
                  ) : (
                    <span className="block truncate font-medium">{product.name}</span>
                  )}
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.slug}
                  </span>
                </div>
                <AdminStatusPill
                  status={product.status}
                  tone={product.status === "active" ? "success" : "danger"}
                  label={product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                />
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Category</dt>
                  <dd className="mt-0.5 font-medium">{product.categoryCode}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {locationOperations ? "Priced variants" : "Active variants"}
                  </dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {locationOperations
                      ? `${product.pricedSkuCount} / ${product.activeSkuCount}`
                      : `${product.activeSkuCount} / ${product.skuCount}`}
                  </dd>
                </div>
                {locationOperations ? (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">Location price</dt>
                      <dd
                        className={`mt-0.5 ${product.priceRange ? "font-medium" : "text-muted-foreground"}`}
                      >
                        {priceRange(product)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Selling status</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {product.availableSkuCount} / {product.activeSkuCount} selling
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`}
                  >
                    Full details
                  </a>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open mobile actions for ${product.name}`}
                      className="size-8 rounded-md"
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onOpenProduct ? (
                      <DropdownMenuItem onSelect={() => onOpenProduct(product)}>
                        <Eye aria-hidden="true" />
                        Preview
                      </DropdownMenuItem>
                    ) : null}
                    {canManage ? (
                      <DropdownMenuItem asChild>
                        <a
                          href={`/admin/catalog/products/${product.productId}/edit${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`}
                        >
                          <Pencil aria-hidden="true" />
                          Edit product
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void copyProductId(product.productId)}>
                      <Clipboard aria-hidden="true" />
                      {copiedProductId === product.productId ? "ID copied" : "Copy ID"}
                    </DropdownMenuItem>
                    {canManage && product.status === "active" ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:bg-muted focus:text-destructive"
                          disabled={deactivationPending || !onDeactivateSelected}
                          onSelect={() => setRowToDeactivate(product)}
                        >
                          <PowerOff aria-hidden="true" />
                          Deactivate
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
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
                {locationOperations && visibleColumns.has("price") ? (
                  <TableHead>Location price</TableHead>
                ) : null}
                {visibleColumns.has("variant") ? (
                  <TableHead>
                    {locationOperations ? "Priced variants" : "Active variants"}
                  </TableHead>
                ) : null}
                {locationOperations && visibleColumns.has("selling") ? (
                  <TableHead>Selling status</TableHead>
                ) : null}
                {visibleColumns.has("status") ? <TableHead>Status</TableHead> : null}
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((product) => (
                <TableRow
                  key={product.productId}
                  data-product-row={product.productId}
                  data-preview-open={openProductId === product.productId ? "true" : undefined}
                  data-state={selectedIds.has(product.productId) ? "selected" : undefined}
                  className={
                    onOpenProduct
                      ? `cursor-pointer ${
                          openProductId === product.productId ? "bg-secondary" : ""
                        }`
                      : undefined
                  }
                  onClick={(event) => {
                    if (!onOpenProduct) return;
                    const target = event.target;
                    if (
                      target instanceof Element &&
                      target.closest(
                        "button, a, input, select, textarea, [role='checkbox'], [role='menuitem']",
                      )
                    )
                      return;
                    onOpenProduct(product);
                  }}
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
                          className="size-11 rounded-md border border-border object-cover"
                          height={44}
                          loading="lazy"
                          src={`/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(product.primaryMedia.mediaId)}/content?v=${product.primaryMedia.version}${locationScope ? `&locationId=${encodeURIComponent(locationScope.locationId)}` : ""}`}
                          width={44}
                        />
                      ) : (
                        <span className="grid size-11 place-items-center rounded-md border border-dashed border-border bg-muted">
                          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                        </span>
                      )}
                      <span>
                        {onOpenProduct ? (
                          <button
                            type="button"
                            aria-label={`Preview ${product.name}`}
                            aria-expanded={openProductId === product.productId}
                            aria-controls={detailPanelId}
                            className="block text-left font-medium hover:underline"
                            onClick={() => onOpenProduct(product)}
                          >
                            {product.name}
                          </button>
                        ) : (
                          <span className="block font-medium">{product.name}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">{product.slug}</span>
                      </span>
                    </div>
                  </TableCell>
                  {visibleColumns.has("category") ? (
                    <TableCell>{product.categoryCode}</TableCell>
                  ) : null}
                  {locationOperations && visibleColumns.has("price") ? (
                    <TableCell>
                      <span
                        className={product.priceRange ? "font-medium" : "text-muted-foreground"}
                      >
                        {priceRange(product)}
                      </span>
                    </TableCell>
                  ) : null}
                  {visibleColumns.has("variant") ? (
                    <TableCell>
                      <span className="font-medium">
                        {locationOperations
                          ? `${product.pricedSkuCount} / ${product.activeSkuCount}`
                          : `${product.activeSkuCount} / ${product.skuCount}`}
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
                  {visibleColumns.has("status") ? (
                    <TableCell>
                      <AdminStatusPill
                        status={product.status}
                        tone={product.status === "active" ? "success" : "danger"}
                        label={product.status.charAt(0).toUpperCase() + product.status.slice(1)}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="w-12 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open actions for ${product.name}`}
                          className="size-7 rounded-md"
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onOpenProduct ? (
                          <DropdownMenuItem onSelect={() => onOpenProduct(product)}>
                            <Eye aria-hidden="true" />
                            View details
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem asChild>
                            <a
                              href={`/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`}
                            >
                              <Eye aria-hidden="true" />
                              View details
                            </a>
                          </DropdownMenuItem>
                        )}
                        {canManage ? (
                          <DropdownMenuItem asChild>
                            <a
                              href={`/admin/catalog/products/${product.productId}/edit${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`}
                            >
                              <Pencil aria-hidden="true" />
                              Edit product
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => void copyProductId(product.productId)}>
                          <Clipboard aria-hidden="true" />
                          {copiedProductId === product.productId ? "ID copied" : "Copy ID"}
                        </DropdownMenuItem>
                        {canManage && product.status === "active" ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-muted focus:text-destructive"
                              disabled={deactivationPending || !onDeactivateSelected}
                              onSelect={() => setRowToDeactivate(product)}
                            >
                              <PowerOff aria-hidden="true" />
                              Deactivate
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {page.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground" role="status">
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
      <ConfirmCommandDialog
        open={rowToDeactivate !== null}
        title="Deactivate product?"
        resource={rowToDeactivate?.name ?? "Product"}
        scope="Global Catalog"
        consequence="This Product leaves storefront availability. Variants, prices, inventory history, and committed order snapshots remain intact."
        confirmLabel="Confirm deactivation"
        cancelLabel="Cancel"
        pending={deactivationPending}
        onCancel={() => setRowToDeactivate(null)}
        onConfirm={(reason) => {
          if (rowToDeactivate) void deactivateProduct(rowToDeactivate, reason);
        }}
      />
    </div>
  );
}
