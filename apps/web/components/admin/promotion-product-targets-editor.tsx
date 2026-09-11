"use client";
import { useEffect, useState } from "react";
import type {
  AdminProductDetail,
  AdminProductSummary,
  AdminPromotionProductTargetInput,
} from "@freshmarkets/contracts";
import { z, adminProductDetailSchema, adminProductSummarySchema } from "@freshmarkets/validation";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { catalogResultSchema } from "./catalog-command-state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export type SaleTargetSelection = AdminPromotionProductTargetInput & {
  productName?: string;
  skuName?: string;
  locationName?: string;
};
const saleProductPageSchema = z.object({
  items: z.array(adminProductSummarySchema),
  nextCursor: z.string().nullable(),
});

/** Create and Edit share the existing, permission-checked catalog reads. */
export function PromotionProductTargetsEditor({
  enabled,
  onEnabledChange,
  value,
  onChange,
  disabled,
  alwaysOn = false,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: readonly SaleTargetSelection[];
  onChange: (value: SaleTargetSelection[]) => void;
  disabled: boolean;
  /** Inventory sales always target products; skip the enable checkbox. */
  alwaysOn?: boolean;
}) {
  const { state } = useAdminContext();
  const locations =
    state.phase === "ready" ? state.scopes.filter((scope) => scope.kind === "location") : [];
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<{
    items: AdminProductSummary[];
    nextCursor: string | null;
  } | null>(null);
  const [productId, setProductId] = useState("");
  const [product, setProduct] = useState<AdminProductDetail | null>(null);
  const [skuId, setSkuId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setPage(null);
    setError(null);
    const params = new URLSearchParams({
      scopeKind: "GLOBAL",
      status: "active",
      limit: "25",
    });
    if (query) params.set("query", query);
    if (cursor) params.set("cursor", cursor);
    void fetch(`/api/admin/catalog/products?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((raw: unknown) => {
        const result = catalogResultSchema(saleProductPageSchema).parse(raw);
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) setPage(result.value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Products could not be loaded.");
      });
    return () => controller.abort();
  }, [enabled, query, cursor, reload]);
  useEffect(() => {
    setProduct(null);
    setSkuId("");
    if (!enabled || !productId) return;
    const controller = new AbortController();
    void fetch(`/api/admin/catalog/products/${encodeURIComponent(productId)}?scopeKind=GLOBAL`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((raw: unknown) => {
        const result = catalogResultSchema(adminProductDetailSchema).parse(raw);
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) setProduct(result.value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Selling options could not be loaded.");
      });
    return () => controller.abort();
  }, [enabled, productId, reload]);
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-lg border p-3 sm:col-span-2 lg:col-span-3"
    >
      {alwaysOn ? null : (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          Sale on selected products
        </label>
      )}
      {alwaysOn || enabled ? (
        <>
          <p className="text-sm text-muted-foreground">
            Discount applies to each selling unit automatically. Choose the option and location. An
            optional quantity limits this sale to Instant orders; the full requested quantity must
            fit.
          </p>
          <ul className="space-y-2">
            {value.map((target, index) => (
              <li
                key={`${target.skuId}:${target.locationId}`}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {target.productName ?? "Selected product"} · {target.skuName ?? "Selling option"}{" "}
                  · {target.locationName ?? "Selected location"} —{" "}
                  {target.quantityLimit === null
                    ? "No sale quantity limit"
                    : `${target.quantityLimit} units for this sale`}
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
          <div className="flex gap-2">
            <Input
              aria-label="Search sale products"
              placeholder="Search products"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery(search.trim());
                setCursor(null);
                setReload((current) => current + 1);
              }}
            >
              Search
            </Button>
          </div>
          {error ? (
            <div role="alert" className="text-sm">
              {error}{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => setReload((current) => current + 1)}
              >
                Retry loading
              </Button>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={productId} disabled={disabled || !page} onValueChange={setProductId}>
              <SelectTrigger aria-label="Sale product">
                <SelectValue placeholder={page ? "Choose product" : "Loading products…"} />
              </SelectTrigger>
              <SelectContent>
                {page?.items.map((item) => (
                  <SelectItem key={item.productId} value={item.productId}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={skuId} disabled={disabled || !product} onValueChange={setSkuId}>
              <SelectTrigger aria-label="Sale selling option">
                <SelectValue placeholder="Choose selling option" />
              </SelectTrigger>
              <SelectContent>
                {product?.skus
                  .filter((sku) => sku.status === "active")
                  .map((sku) => (
                    <SelectItem key={sku.skuId} value={sku.skuId}>
                      {sku.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={locationId} disabled={disabled} onValueChange={setLocationId}>
              <SelectTrigger aria-label="Sale location">
                <SelectValue placeholder="Choose location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.locationId} value={location.locationId}>
                    {location.locationName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Sale quantity limit"
              type="number"
              min={1}
              step={1}
              placeholder="Sale units (optional, Instant only)"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {cursor ? (
              <Button type="button" variant="outline" onClick={() => setCursor(null)}>
                First products
              </Button>
            ) : null}
            {page?.nextCursor ? (
              <Button type="button" variant="outline" onClick={() => setCursor(page.nextCursor)}>
                More products
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !skuId || !locationId || value.length >= 100}
              onClick={() => {
                const limit = quantity === "" ? null : Number(quantity);
                const sku = product?.skus.find((item) => item.skuId === skuId);
                const location = locations.find((item) => item.locationId === locationId);
                if (
                  !sku ||
                  !location ||
                  (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))
                ) {
                  setError(
                    "Choose an option, location, and a positive whole quantity or leave it blank.",
                  );
                  return;
                }
                if (
                  value.some((target) => target.skuId === skuId && target.locationId === locationId)
                ) {
                  setError("This option and location are already selected.");
                  return;
                }
                setError(null);
                onChange([
                  ...value,
                  {
                    skuId,
                    locationId,
                    quantityLimit: limit,
                    productName: product?.name,
                    skuName: sku.name,
                    locationName: location.locationName,
                  },
                ]);
                setQuantity("");
              }}
            >
              Add to sale
            </Button>
          </div>
          {!value.length ? (
            <p className="text-sm">
              Add at least one selling option before saving this product sale.
            </p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
