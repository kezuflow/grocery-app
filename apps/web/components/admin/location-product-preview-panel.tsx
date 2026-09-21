"use client";

import type {
  AdminCatalogSkuSummary,
  AdminProductDetail,
  AdminSkuPricesView,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import { adminCatalogSkuSummarySchema, z } from "@freshmarkets/validation";
import { ExternalLink, ImageIcon, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useAdminCommandIntent } from "./admin-command-state";
import { AdminStatusPill } from "./admin-status-pill";

type LocationScope = Extract<AdminProductDetail["scope"], { kind: "LOCATION" }>;
type LocationProductDetail = AdminProductDetail & { scope: LocationScope };

function isLocationProductDetail(product: AdminProductDetail): product is LocationProductDetail {
  return product.scope.kind === "LOCATION";
}

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const priceResultSchema = z.union([
  failureSchema,
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      skuId: z.string(),
      locationId: z.string(),
      marketId: z.string(),
      currency: z.string(),
      latestVersion: z.number().int().nonnegative(),
      canManage: z.boolean(),
      currentPriceMinor: z.number().int().positive().nullable(),
      history: z.array(
        z.object({
          version: z.number().int().positive(),
          amountMinor: z.number().int().positive(),
          currency: z.string(),
          validFrom: z.number().int(),
          validTo: z.number().int().nullable(),
        }),
      ),
    }),
  }),
]);
const commandResultSchema = z.union([
  failureSchema,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminCatalogSkuSummarySchema }),
]);

type PriceCommand = {
  skuId: string;
  marketId: string;
  locationId: string;
  currency: string;
  amountMinor: number;
  validFrom: number;
  expectedVersion: number;
};

function money(amountMinor: number | null, currency: string): string {
  if (amountMinor === null) return "Set price";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function priceInputValue(amountMinor: number | null): string {
  return amountMinor === null ? "" : (amountMinor / 100).toFixed(2);
}

function mediaUrl(product: LocationProductDetail): string | null {
  const primary = product.media.find((media) => media.isPrimary) ?? product.media[0];
  if (!primary) return null;
  return `/api/admin/catalog/products/${encodeURIComponent(product.productId)}/media/${encodeURIComponent(primary.mediaId)}/content?v=${primary.version}&locationId=${encodeURIComponent(product.scope.locationId)}`;
}

async function loadPrices(skuId: string, locationId: string) {
  const response = await fetch(
    `/api/admin/catalog/skus/${encodeURIComponent(skuId)}/prices?${new URLSearchParams({ locationId })}`,
  );
  return priceResultSchema.parse(await response.json());
}

function LocationSkuPriceRow({
  sku,
  product,
  image,
  canManagePrices,
  onSaved,
  onRecoveryStateChange,
}: {
  sku: AdminCatalogSkuSummary;
  product: LocationProductDetail;
  image: string | null;
  canManagePrices: boolean;
  onSaved: () => void;
  onRecoveryStateChange: (skuId: string, active: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<AdminSkuPricesView | null>(null);
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [command, setCommand] = useState<PriceCommand | null>(null);
  const [savedPriceMinor, setSavedPriceMinor] = useState<number | null | undefined>(undefined);
  const intent = useAdminCommandIntent();
  const displayedPrice = savedPriceMinor === undefined ? sku.priceMinor : savedPriceMinor;

  useEffect(() => {
    onRecoveryStateChange(sku.skuId, command !== null || intent.pending);
    return () => onRecoveryStateChange(sku.skuId, false);
  }, [command, intent.pending, onRecoveryStateChange, sku.skuId]);

  const openEditor = useCallback(async () => {
    setEditing(true);
    setLoading(true);
    setNotice(null);
    try {
      const result = await loadPrices(sku.skuId, product.scope.locationId);
      if (!result.ok) {
        setNotice(`${result.error.message} Request reference: ${result.error.requestId}`);
        return;
      }
      setView(result.value);
      setAmount(priceInputValue(result.value.currentPriceMinor));
      if (!result.value.canManage) {
        setNotice("You do not have price-management access for this fulfillment location.");
      }
    } catch {
      setNotice("The location price could not be loaded. Select the price to try again.");
    } finally {
      setLoading(false);
    }
  }, [product.scope.locationId, sku.skuId]);

  const submit = useCallback(
    async (pending: PriceCommand) => {
      setCommand(pending);
      try {
        const result = await intent.submit(async (key) => {
          const response = await fetch(
            `/api/admin/catalog/skus/${encodeURIComponent(pending.skuId)}/price`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(pending),
            },
          );
          return commandResultSchema.parse(
            await response.json(),
          ) as RpcResult<AdminCatalogSkuSummary>;
        });
        setCommand(null);
        if (result.ok) {
          setSavedPriceMinor(pending.amountMinor);
          setNotice("Location price saved.");
          setEditing(false);
          onSaved();
        } else {
          setNotice(`${result.error.message} Request reference: ${result.error.requestId}`);
        }
      } catch {
        setNotice("The price could not be confirmed. Select Retry save to send the same request.");
      }
    },
    [intent, onSaved],
  );

  function prepareCommand(): PriceCommand | null {
    if (!view) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setNotice("Enter a positive price with at most two decimal places.");
      return null;
    }
    const [whole, fraction = ""] = amount.split(".");
    const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      setNotice("Enter a positive price with at most two decimal places.");
      return null;
    }
    return {
      skuId: sku.skuId,
      marketId: view.marketId,
      locationId: view.locationId,
      currency: view.currency,
      amountMinor,
      validFrom: Date.now(),
      expectedVersion: view.latestVersion,
    };
  }

  return (
    <article className="border-b border-[var(--fm-border)] p-3 last:border-b-0">
      <div className="flex items-center gap-3">
        {image ? (
          <img
            src={image}
            alt=""
            className="size-12 shrink-0 rounded-md border border-[var(--fm-border)] object-cover"
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-[var(--fm-admin-surface-muted)]">
            <ImageIcon className="size-4 text-[var(--fm-text-muted)]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{sku.name}</p>
          {canManagePrices ? (
            <button
              type="button"
              className="mt-0.5 inline-flex items-center gap-1 rounded text-left text-sm font-semibold text-[var(--fm-admin-accent-strong)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
              aria-label={`Edit price for ${sku.name}`}
              disabled={command !== null || intent.pending}
              onClick={() => void openEditor()}
            >
              {money(displayedPrice, product.scope.currency)}
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
          ) : (
            <p className="mt-0.5 text-sm font-semibold">
              {money(displayedPrice, product.scope.currency)}
            </p>
          )}
        </div>
        <AdminStatusPill
          status={sku.availability ?? "not-configured"}
          tone={sku.availability === "AVAILABLE" ? "success" : "neutral"}
          label={sku.availability === "AVAILABLE" ? "Selling" : "Not selling"}
        />
      </div>

      {editing ? (
        <form
          className="mt-3 grid gap-3 rounded-md bg-[var(--fm-admin-surface-muted)] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (command) {
              void submit(command);
              return;
            }
            const pending = prepareCommand();
            if (pending) void submit(pending);
          }}
        >
          {loading ? (
            <p role="status" className="text-sm text-[var(--fm-text-muted)]">
              Loading location price…
            </p>
          ) : view?.canManage ? (
            <>
              <label className="grid gap-1 text-sm font-medium">
                Price ({view.currency})
                <Input
                  aria-label={`Price for ${sku.name}`}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  disabled={command !== null || intent.pending}
                  required
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={command !== null || intent.pending}
                  onClick={() => {
                    setEditing(false);
                    setNotice(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={intent.pending}>
                  {intent.pending ? "Saving…" : command ? "Retry save" : "Save price"}
                </Button>
              </div>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => void openEditor()}>
              Retry price
            </Button>
          )}
        </form>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-xs text-[var(--fm-text-muted)]">
          {notice}
        </p>
      ) : null}
    </article>
  );
}

export function LocationProductPreviewPanel({
  product,
  fromQuery,
  canManagePrices,
  onClose,
  onPriceSaved,
  onRecoveryStateChange,
}: {
  product: AdminProductDetail;
  fromQuery: string;
  canManagePrices: boolean;
  onClose: () => void;
  onPriceSaved: () => void;
  onRecoveryStateChange: (active: boolean) => void;
}) {
  if (!isLocationProductDetail(product)) return null;
  return (
    <LocationProductPreviewPanelContent
      product={product}
      fromQuery={fromQuery}
      canManagePrices={canManagePrices}
      onClose={onClose}
      onPriceSaved={onPriceSaved}
      onRecoveryStateChange={onRecoveryStateChange}
    />
  );
}

function LocationProductPreviewPanelContent({
  product,
  fromQuery,
  canManagePrices,
  onClose,
  onPriceSaved,
  onRecoveryStateChange,
}: {
  product: LocationProductDetail;
  fromQuery: string;
  canManagePrices: boolean;
  onClose: () => void;
  onPriceSaved: () => void;
  onRecoveryStateChange: (active: boolean) => void;
}) {
  const image = mediaUrl(product);
  const [recoveringSkus, setRecoveringSkus] = useState<ReadonlySet<string>>(new Set());
  const recoveryActive = recoveringSkus.size > 0;
  const detailHref = `/admin/catalog/products/${product.productId}${fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""}`;

  const updateRecovery = useCallback((skuId: string, active: boolean) => {
    setRecoveringSkus((current) => {
      const next = new Set(current);
      if (active) next.add(skuId);
      else next.delete(skuId);
      return next;
    });
  }, []);

  useEffect(() => {
    onRecoveryStateChange(recoveryActive);
    return () => onRecoveryStateChange(false);
  }, [onRecoveryStateChange, recoveryActive]);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
            {product.scope.locationName} fulfillment preview
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
          aria-label="Close location product preview"
          disabled={recoveryActive}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section className="flex items-center gap-4" aria-label="Location product identity">
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
            <p className="mt-1 truncate text-xs text-[var(--fm-text-muted)]">
              {product.scope.locationName} · {product.scope.marketName}
            </p>
          </div>
        </section>

        <section
          className="mt-6 border-t border-[var(--fm-border)] pt-5"
          aria-labelledby="location-product-options"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="location-product-options" className="text-sm font-semibold">
                Location selling options
              </h3>
              <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                Click a price to change it for {product.scope.locationName} only.
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
                <LocationSkuPriceRow
                  key={sku.skuId}
                  sku={sku}
                  product={product}
                  image={image}
                  canManagePrices={canManagePrices}
                  onSaved={onPriceSaved}
                  onRecoveryStateChange={updateRecovery}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="mt-6 border-t border-[var(--fm-border)] pt-5"
          aria-label="Location product metadata"
        >
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-[var(--fm-text-muted)]">Fulfillment location</dt>
            <dd className="font-medium">{product.scope.locationName}</dd>
            <dt className="text-[var(--fm-text-muted)]">Currency</dt>
            <dd>{product.scope.currency}</dd>
            <dt className="text-[var(--fm-text-muted)]">Available stock</dt>
            <dd>
              {product.inventoryPool.position
                ? `${product.inventoryPool.position.availableBase.toLocaleString()} ${product.inventoryPool.baseUnitSymbol}`
                : "Not recorded"}
            </dd>
          </dl>
        </section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button type="button" variant="outline" disabled={recoveryActive} onClick={onClose}>
          Close
        </Button>
        <Button asChild>
          <Link href={detailHref} prefetch={false}>
            <ExternalLink aria-hidden="true" />
            View location details
          </Link>
        </Button>
      </div>
    </>
  );
}
