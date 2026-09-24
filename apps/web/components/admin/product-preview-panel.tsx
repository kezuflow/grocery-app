"use client";

import type { AdminProductDetail } from "@freshmarkets/contracts";
import {
  adminCatalogSkuSummarySchema,
  adminProductCategoriesBodySchema,
  adminProductSummarySchema,
  adminProductStatusBodySchema,
  adminProductUpdateBodySchema,
  adminSkuUpdateBodySchema,
} from "@freshmarkets/validation";
import { ChevronsUpDown, ExternalLink, ImageIcon, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { AdminStatusPill } from "./admin-status-pill";
import { useCategoryOptions } from "./category-authoring-state";
import { useCatalogCommand } from "./catalog-command-state";
import { useAdminScopeGuard } from "@/app/admin/admin-context-provider";

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

export function GlobalProductPreviewPanel({
  product,
  fromQuery,
  onClose,
  onSaved,
}: {
  product: AdminProductDetail;
  fromQuery: string;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const categoryOptions = useCategoryOptions();
  const productCommand = useCatalogCommand(adminProductSummarySchema);
  const skuCommand = useCatalogCommand(adminCatalogSkuSummarySchema);
  const categoryCommand = useCatalogCommand(adminProductSummarySchema);
  const [categoryIds, setCategoryIds] = useState(() =>
    product.categories.map((item) => item.categoryId),
  );
  const [name, setName] = useState(product.name);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setCategoryIds(product.categories.map((item) => item.categoryId));
    setName(product.name);
  }, [product.categories, product.version]);
  const image = mediaUrl(product);
  const detailHref = `/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`;
  const editHref = `/admin/catalog/products/${product.productId}/edit${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`;
  const latestRecordedChange = product.recentAudit
    .map((event) => event.occurredAt)
    .sort()
    .at(-1);
  const canManage = product.allowedActions.includes("UPDATE");
  const nameChanged = name.trim() !== product.name;
  const frozen =
    productCommand.pending ||
    productCommand.uncertain ||
    skuCommand.pending ||
    skuCommand.uncertain ||
    categoryCommand.pending ||
    categoryCommand.uncertain;
  const hasDraft = nameChanged;
  const commandLocked = frozen || hasDraft;
  const categoriesChanged =
    JSON.stringify(categoryIds) !==
    JSON.stringify(product.categories.map((item) => item.categoryId));
  useAdminScopeGuard(hasDraft || categoriesChanged, frozen);
  const selectedCategoryNames = categoryIds.map((categoryId) => {
    const category =
      categoryOptions.items.find((item) => item.categoryId === categoryId) ??
      product.categories.find((item) => item.categoryId === categoryId);
    return category?.name ?? categoryId;
  });
  const categorySummary =
    selectedCategoryNames.length > 1
      ? `${selectedCategoryNames[0]} +${selectedCategoryNames.length - 1} more`
      : (selectedCategoryNames[0] ?? "Choose categories");

  async function saveName() {
    if (!nameChanged || frozen) return;
    const body = adminProductUpdateBodySchema.safeParse({
      categoryId: product.categoryId,
      slug: product.slug,
      name,
      description: product.description,
      customerDetails: product.customerDetails.map((detail) => ({
        label: detail.label,
        value: detail.value,
        sortOrder: detail.sortOrder,
      })),
      expectedVersion: product.version,
    });
    if (!body.success) return setNotice("Enter a Product name between 1 and 160 characters.");
    try {
      const result = await productCommand.submit(
        `/api/admin/catalog/products/${encodeURIComponent(product.productId)}`,
        body.data,
        "PATCH",
        { title: "Product name saved" },
      );
      if (!result) return;
      if (!result.ok) return setNotice(result.error.message);
      setNotice(null);
      await onSaved?.();
    } catch {
      setNotice("The Product name change could not be confirmed. Retry the same save.");
    }
  }

  async function setProductStatus(status: "active" | "inactive") {
    if (status === product.status || commandLocked) return;
    const body = adminProductStatusBodySchema.parse({
      status,
      reason: "Changed from Global product preview",
      expectedVersion: product.version,
    });
    try {
      const result = await productCommand.submit(
        `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/status`,
        body,
        "POST",
        { title: status === "active" ? "Product activated" : "Product deactivated" },
      );
      if (!result) return;
      if (!result.ok) return setNotice(result.error.message);
      setNotice(null);
      await onSaved?.();
    } catch {
      setNotice("The Product status could not be confirmed. Retry the same change.");
    }
  }

  async function setVariantStatus(skuId: string, version: number, status: "active" | "inactive") {
    if (commandLocked) return;
    const body = adminSkuUpdateBodySchema.parse({ status, expectedVersion: version });
    try {
      const result = await skuCommand.submit(
        `/api/admin/catalog/skus/${encodeURIComponent(skuId)}`,
        body,
        "PATCH",
        { title: status === "active" ? "Variant activated" : "Variant deactivated" },
      );
      if (!result) return;
      if (!result.ok) return setNotice(result.error.message);
      setNotice(null);
      await onSaved?.();
    } catch {
      setNotice("The variant status could not be confirmed. Retry the same change.");
    }
  }

  async function saveCategories(nextCategoryIds: string[]) {
    if (frozen) return;
    const body = adminProductCategoriesBodySchema.safeParse({
      categoryIds: nextCategoryIds,
      expectedVersion: product.version,
    });
    if (!body.success) {
      setCategoryIds(product.categories.map((item) => item.categoryId));
      return setNotice("Choose at least one category.");
    }
    try {
      const result = await categoryCommand.submit(
        `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/categories`,
        body.data,
        "PATCH",
        { title: "Product categories saved" },
      );
      if (!result) return;
      if (!result.ok) {
        setCategoryIds(product.categories.map((item) => item.categoryId));
        return setNotice(result.error.message);
      }
      setNotice(null);
      await onSaved?.();
    } catch {
      setNotice("The category change could not be confirmed. Retry the same save.");
    }
  }

  async function retryUncertainChange() {
    try {
      const result = productCommand.uncertain
        ? await productCommand.retry()
        : skuCommand.uncertain
          ? await skuCommand.retry()
          : await categoryCommand.retry();
      if (!result) return;
      if (!result.ok) return setNotice(result.error.message);
      setNotice(null);
      await onSaved?.();
    } catch {
      setNotice("The change still could not be confirmed. Retry the saved change again.");
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            Global product preview
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
          disabled={frozen || hasDraft}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <p className="mb-5 text-xs text-[var(--fm-text-muted)]">
          {canManage
            ? "Global manages product identity, status, selling options and categories. Select a fulfillment location for its price and stock."
            : "This Global product is view-only with your current access. Select a fulfillment location to see its price and stock."}
        </p>
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
          <div className="min-w-0 flex-1">
            {canManage ? (
              <div>
                <label
                  htmlFor="product-preview-name"
                  className="text-xs font-medium text-[var(--fm-text-muted)]"
                >
                  Product name
                </label>
                <Input
                  id="product-preview-name"
                  aria-label="Product name"
                  className="mt-1 font-semibold"
                  value={name}
                  maxLength={160}
                  disabled={frozen}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameChanged ? (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={frozen}
                      onClick={() => {
                        setName(product.name);
                        setNotice(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={frozen}
                      onClick={() => void saveName()}
                    >
                      Save name
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <h3 className="truncate text-lg font-bold">{product.name}</h3>
            )}
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
          {canManage ? (
            <Select
              value={product.status}
              disabled={commandLocked}
              onValueChange={(status) => {
                if (status === "active" || status === "inactive") void setProductStatus(status);
              }}
            >
              <SelectTrigger className="w-32" indicator="up-down" aria-label="Product status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <AdminStatusPill
              status={product.status}
              tone={product.status === "active" ? "success" : "danger"}
              label={product.status.charAt(0).toUpperCase() + product.status.slice(1)}
            />
          )}
        </section>

        {notice ? (
          <div className="mt-3 flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-[var(--fm-danger)]">{notice}</p>
            {productCommand.uncertain || skuCommand.uncertain || categoryCommand.uncertain ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void retryUncertainChange()}
              >
                Retry saved change
              </Button>
            ) : null}
          </div>
        ) : null}

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
                    <p className="mt-0.5 text-xs text-[var(--fm-text-muted)]">
                      {sku.code} · {sku.sellQuantity.toLocaleString()} {sku.unitSymbol}
                    </p>
                  </div>
                  {canManage ? (
                    <Select
                      value={sku.status}
                      disabled={commandLocked}
                      onValueChange={(status) => {
                        if (status === "active" || status === "inactive")
                          void setVariantStatus(sku.skuId, sku.version, status);
                      }}
                    >
                      <SelectTrigger
                        className="w-28"
                        indicator="up-down"
                        aria-label={`${sku.name} status`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <AdminStatusPill
                      status={sku.status}
                      tone={sku.status === "active" ? "success" : "neutral"}
                      label={sku.status.charAt(0).toUpperCase() + sku.status.slice(1)}
                    />
                  )}
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
          aria-labelledby="product-preview-categories"
        >
          <div>
            <h3 id="product-preview-categories" className="text-sm font-semibold">
              Categories
            </h3>
            <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
              {canManage
                ? "Choose one or more. The first category is primary."
                : "Assigned categories for this product."}
            </p>
          </div>
          {canManage ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Product categories"
                  className="mt-3 w-full justify-between px-3 font-normal"
                  disabled={frozen || nameChanged || categoryOptions.loading}
                >
                  <span className="truncate">{categorySummary}</span>
                  <ChevronsUpDown className="opacity-50" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] min-w-72 p-2"
              >
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {categoryOptions.items.map((category) => {
                    const checked = categoryIds.includes(category.categoryId);
                    return (
                      <label
                        key={category.categoryId}
                        className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={frozen || (checked && categoryIds.length === 1)}
                          onCheckedChange={(next) => {
                            const nextCategoryIds =
                              next === true
                                ? categoryIds.includes(category.categoryId)
                                  ? categoryIds
                                  : [...categoryIds, category.categoryId]
                                : categoryIds.filter((id) => id !== category.categoryId);
                            if (nextCategoryIds === categoryIds) return;
                            setCategoryIds(nextCategoryIds);
                            void saveCategories(nextCategoryIds);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{category.name}</span>
                        {checked && categoryIds[0] === category.categoryId ? (
                          <span className="text-xs text-[var(--fm-text-muted)]">Primary</span>
                        ) : null}
                      </label>
                    );
                  })}
                  {categoryOptions.error ? (
                    <p className="p-2 text-xs text-[var(--fm-danger)]">{categoryOptions.error}</p>
                  ) : null}
                </div>
                {categoryOptions.hasMore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={categoryOptions.loadMore}
                  >
                    Load more
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : (
            <p className="mt-3 text-sm font-medium">{categorySummary}</p>
          )}
        </section>

        <section
          className="mt-6 border-t border-[var(--fm-border)] pt-5"
          aria-label="Product metadata"
        >
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-[var(--fm-text-muted)]">Primary category</dt>
            <dd className="font-medium">{product.categories[0]?.name ?? product.categoryName}</dd>
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
        {frozen || hasDraft ? (
          <Button type="button" variant="outline" disabled>
            <ExternalLink aria-hidden="true" /> View product
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={detailHref} prefetch={false}>
              <ExternalLink aria-hidden="true" />
              View product
            </Link>
          </Button>
        )}
        {product.allowedActions.includes("UPDATE") && !frozen && !hasDraft ? (
          <Button asChild>
            <Link href={editHref} prefetch={false}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={frozen || hasDraft} onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </>
  );
}
