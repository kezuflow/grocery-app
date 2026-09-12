"use client";
import { useEffect, useState } from "react";
import type {
  AdminProductDetail,
  AdminProductSummary,
  AdminPromotionProductTargetInput,
} from "@freshmarkets/contracts";
import { z, adminProductDetailSchema } from "@freshmarkets/validation";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { catalogResultSchema } from "./catalog-command-state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../ui/combobox";

export type SaleTargetSelection = AdminPromotionProductTargetInput & {
  productName?: string;
  skuName?: string;
  locationName?: string;
};

export type SaleDiscountPreview = {
  mode: "PERCENT" | "FIXED";
  value: number;
};

const productPageSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      slug: z.string(),
      categoryCode: z.string(),
      name: z.string(),
      status: z.enum(["active", "inactive"]),
      skuCount: z.number(),
      version: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const SEARCH_DEBOUNCE_MILLISECONDS = 300;

function peso(minor: number): string {
  return `₱${(minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function salePrice(
  priceMinor: number,
  preview: SaleDiscountPreview | null,
): { priceMinor: number; savedMinor: number } | null {
  if (!preview) return null;
  const discountMinor =
    preview.mode === "PERCENT"
      ? Math.round((priceMinor * preview.value) / 100)
      : Math.round(preview.value * 100);
  if (discountMinor <= 0 || discountMinor >= priceMinor) return null;
  return { priceMinor: priceMinor - discountMinor, savedMinor: discountMinor };
}

/** Location-scoped sale picker: live product search, option prices/stock,
 * pool choice and overlap awareness. Shares the permission-checked catalog reads. */
export function SaleTargetsPicker({
  value,
  onChange,
  disabled,
  preview,
  activeOverlaps,
}: {
  value: readonly SaleTargetSelection[];
  onChange: (value: SaleTargetSelection[]) => void;
  disabled: boolean;
  preview: SaleDiscountPreview | null;
  activeOverlaps: ReadonlySet<string>;
}) {
  const { state } = useAdminContext();
  const locations =
    state.phase === "ready" ? state.scopes.filter((scope) => scope.kind === "location") : [];
  const [locationId, setLocationId] = useState("");
  const location = locations.find((item) => item.locationId === locationId) ?? locations[0];
  const effectiveLocationId = location?.locationId ?? "";

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<z.infer<typeof productPageSchema> | null>(null);
  const [listState, setListState] = useState<"idle" | "loading" | "error">("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [product, setProduct] = useState<AdminProductSummary | null>(null);
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [skuId, setSkuId] = useState("");
  const [poolMode, setPoolMode] = useState<"WHOLE_STOCK" | "FIXED">("WHOLE_STOCK");
  const [poolPieces, setPoolPieces] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = search.trim();
    const timer = window.setTimeout(() => {
      setQuery(trimmed);
      setCursor(null);
    }, SEARCH_DEBOUNCE_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setListError(null);
    if (!query) {
      setPage({ items: [], nextCursor: null });
      setListState("idle");
      return () => controller.abort();
    }
    setPage(null);
    setListState("loading");
    const params = new URLSearchParams({ scopeKind: "GLOBAL", status: "active", limit: "10" });
    params.set("query", query);
    if (cursor) params.set("cursor", cursor);
    void fetch(`/api/admin/catalog/products?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((raw: unknown) => {
        const result = catalogResultSchema(productPageSchema).parse(raw);
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) {
          setPage(result.value);
          setListState("idle");
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setListState("error");
        setListError(cause instanceof Error ? cause.message : "Products could not be loaded.");
      });
    return () => controller.abort();
  }, [query, cursor, reload]);

  useEffect(() => {
    setProduct(null);
    setDetail(null);
    setSkuId("");
  }, [effectiveLocationId]);

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setSkuId("");
    if (!product || !effectiveLocationId) return;
    // The scope is resolved inside the effect so the dependency stays a
    // stable id; a derived scope object would refetch on every render.
    const scope = locations.find((item) => item.locationId === effectiveLocationId);
    if (!scope) return;
    const controller = new AbortController();
    setDetailState("loading");
    const params = new URLSearchParams({
      scopeKind: "LOCATION",
      marketId: scope.marketId,
      locationId: scope.locationId,
    });
    void fetch(`/api/admin/catalog/products/${encodeURIComponent(product.productId)}?${params}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((raw: unknown) => {
        const result = catalogResultSchema(adminProductDetailSchema).parse(raw);
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) {
          setDetail(result.value);
          setDetailState("idle");
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDetailState("error");
        setDetailError(
          cause instanceof Error ? cause.message : "Selling options could not be loaded.",
        );
      });
    return () => controller.abort();
  }, [product, effectiveLocationId, reload]);

  const options = detail?.skus.filter((sku) => sku.status === "active") ?? [];
  const option = options.find((sku) => sku.skuId === skuId) ?? null;
  const overlap =
    option && effectiveLocationId
      ? activeOverlaps.has(`${option.skuId}:${effectiveLocationId}`)
      : false;
  const approxPieces =
    option && option.availableBase !== null && option.availableBase !== undefined
      ? Math.floor(option.availableBase / Math.max(1, option.consumptionBaseQuantity))
      : null;
  const optionSalePrice = option?.priceMinor != null ? salePrice(option.priceMinor, preview) : null;

  function addTarget(): void {
    if (!option || !location || !product) {
      setError("Choose a location, product, and selling option first.");
      return;
    }
    let limit: number | null = null;
    if (poolMode === "FIXED") {
      limit = Number(poolPieces);
      if (!Number.isSafeInteger(limit) || limit < 1) {
        setError("Enter a positive whole number of pieces for the fixed pool.");
        return;
      }
    }
    if (
      value.some(
        (target) => target.skuId === option.skuId && target.locationId === location.locationId,
      )
    ) {
      setError("This option and location are already in the sale.");
      return;
    }
    setError(null);
    onChange([
      ...value,
      {
        skuId: option.skuId,
        locationId: location.locationId,
        quantityLimit: limit,
        productName: product.name,
        skuName: option.name,
        locationName: location.locationName,
      },
    ]);
    setSkuId("");
    setPoolPieces("");
  }

  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:col-span-2 lg:col-span-3">
      <legend className="text-sm font-semibold">Sale targets</legend>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="sale-location">Location</Label>
          <Select value={effectiveLocationId} onValueChange={setLocationId}>
            <SelectTrigger id="sale-location" aria-label="Sale location">
              <SelectValue placeholder={locations.length ? "Choose location" : "No locations"} />
            </SelectTrigger>
            <SelectContent>
              {locations.map((item) => (
                <SelectItem key={item.locationId} value={item.locationId}>
                  {item.locationName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sale-product-search">Product</Label>
          <Combobox
            items={page?.items ?? []}
            filteredItems={page?.items ?? []}
            filter={null}
            value={product}
            inputValue={product?.name ?? search}
            open={searchOpen && Boolean(search.trim())}
            openOnInputClick={Boolean(search.trim())}
            disabled={disabled}
            itemToStringLabel={(item: AdminProductSummary) => item.name}
            isItemEqualToValue={(item: AdminProductSummary, selected: AdminProductSummary) =>
              item.productId === selected.productId
            }
            onOpenChange={setSearchOpen}
            onInputValueChange={(next, details) => {
              if (
                details.reason !== "input-change" &&
                details.reason !== "input-clear" &&
                details.reason !== "clear-press"
              ) {
                return;
              }
              setSearch(next);
              setSearchOpen(Boolean(next.trim()));
              setProduct(null);
              setDetail(null);
              setSkuId("");
            }}
            onValueChange={(next) => {
              setProduct(next);
              setSearchOpen(false);
              if (next === null) setSearch("");
            }}
          >
            <ComboboxInput
              id="sale-product-search"
              aria-label="Search sale products"
              placeholder="Search products by name…"
              showTrigger={false}
              showClear
              className="w-full"
            />
            <ComboboxContent className="max-h-80 w-[var(--anchor-width)] min-w-[var(--anchor-width)] overflow-hidden border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-0 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)] ring-0 duration-150 [animation-timing-function:var(--fm-ease-out)] motion-reduce:animate-none">
              {listState === "loading" ? (
                <p role="status" className="px-3 py-3 text-sm text-[var(--fm-text-muted)]">
                  Searching products…
                </p>
              ) : listState === "error" ? (
                <div role="alert" className="space-y-2 px-3 py-3 text-sm">
                  <p>{listError ?? "Products could not be loaded."}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReload((count) => count + 1)}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <ComboboxEmpty className="px-3 py-4 text-[var(--fm-text-muted)]">
                    No active products found.
                  </ComboboxEmpty>
                  <ComboboxList className="max-h-64 p-1">
                    {(item: AdminProductSummary) => (
                      <ComboboxItem
                        key={item.productId}
                        value={item}
                        className="rounded-md px-3 py-2.5 text-[var(--fm-text)] data-highlighted:bg-[var(--fm-hover)] data-highlighted:text-[var(--fm-text)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="shrink-0 text-xs text-[var(--fm-text-muted)]">
                          {item.skuCount} {item.skuCount === 1 ? "option" : "options"}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                  {page?.nextCursor ? (
                    <div className="border-t border-[var(--fm-border)] p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setCursor(page.nextCursor)}
                      >
                        More results
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      {product ? (
        detailState === "loading" ? (
          <p role="status" className="text-sm text-[var(--fm-text-muted)]">
            Loading selling options for {product.name} at {location?.locationName}…
          </p>
        ) : detailState === "error" ? (
          <div role="alert" className="text-sm">
            {detailError ?? "Selling options could not be loaded."}{" "}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReload((n) => n + 1)}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm font-medium">Selling options — {product.name}</p>
            <ul aria-label="Selling options" className="divide-y rounded-lg border">
              {options.map((sku) => {
                const selected = sku.skuId === skuId;
                return (
                  <li key={sku.skuId}>
                    <button
                      type="button"
                      onClick={() => setSkuId(sku.skuId)}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-[var(--fm-hover)] ${
                        selected ? "bg-[var(--fm-surface-soft)]" : ""
                      }`}
                    >
                      <span className="font-medium">
                        {sku.name}{" "}
                        <span className="text-xs text-[var(--fm-text-muted)]">
                          ({sku.unitSymbol})
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-xs">
                        {sku.priceMinor != null ? (
                          <span>{peso(sku.priceMinor)}</span>
                        ) : (
                          <span className="text-[var(--fm-text-muted)]">
                            No price at this location
                          </span>
                        )}
                        {sku.availability ? (
                          <span
                            className={
                              sku.availability === "AVAILABLE"
                                ? "text-emerald-700"
                                : "text-amber-700"
                            }
                          >
                            {sku.availability === "AVAILABLE" ? "Available" : "Unavailable"}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {options.length === 0 ? (
                <li className="px-4 py-3 text-sm text-[var(--fm-text-muted)]">
                  No active selling options for this product.
                </li>
              ) : null}
            </ul>
          </div>
        )
      ) : !query ? (
        <p className="text-sm text-[var(--fm-text-muted)]">
          Search to find products and selling options.
        </p>
      ) : null}

      {option ? (
        <div className="grid gap-3 rounded-lg bg-[var(--fm-surface-soft)] p-3 text-sm">
          {option.priceMinor != null && optionSalePrice ? (
            <p>
              <span className="font-medium">
                {option.name} sale price:{" "}
                <s className="text-[var(--fm-text-muted)]">{peso(option.priceMinor)}</s>{" "}
                {peso(optionSalePrice.priceMinor)}
              </span>{" "}
              <span className="text-xs text-[var(--fm-text-muted)]">
                (saves {peso(optionSalePrice.savedMinor)} per unit)
              </span>
            </p>
          ) : option.priceMinor != null ? (
            <p className="text-[var(--fm-text-muted)]">
              Enter a discount smaller than the regular price ({peso(option.priceMinor)}) to preview
              the sale price.
            </p>
          ) : null}
          {approxPieces !== null ? (
            <p className="text-xs text-[var(--fm-text-muted)]">
              ≈ {approxPieces.toLocaleString("en-PH")} sellable pieces currently available at{" "}
              {location?.locationName}.
            </p>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
              Sale quantity
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sale-pool"
                checked={poolMode === "WHOLE_STOCK"}
                onChange={() => setPoolMode("WHOLE_STOCK")}
              />
              Whole stock — allowance follows availability; no fixed limit
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="sale-pool"
                checked={poolMode === "FIXED"}
                onChange={() => setPoolMode("FIXED")}
              />
              Fixed clearance pool —
              <Input
                aria-label="Fixed pool pieces"
                type="number"
                min={1}
                step={1}
                placeholder="pcs"
                value={poolPieces}
                onChange={(event) => setPoolPieces(event.target.value)}
                className="h-8 w-24"
                disabled={poolMode !== "FIXED"}
              />
              pieces total across all customers (Instant only)
            </label>
          </fieldset>
          {overlap ? (
            <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              Another active sale already covers this option at this location. Core will reject
              activation while it runs; you can still save this draft.
            </p>
          ) : null}
          <div>
            <Button type="button" size="sm" onClick={addTarget}>
              Add to sale
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {value.length > 0 ? (
        <ul className="grid gap-2">
          {value.map((target, index) => (
            <li
              key={`${target.skuId}:${target.locationId}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                {target.productName} · {target.skuName} · {target.locationName} —{" "}
                {target.quantityLimit === null ? "whole stock" : `${target.quantityLimit} pcs pool`}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(value.filter((_, item) => item !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--fm-text-muted)]">
          Add at least one selling option before creating the sale.
        </p>
      )}
    </fieldset>
  );
}
