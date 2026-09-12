"use client";

import type {
  AdminCatalogSkuSummary,
  AdminScopeOptionView,
  AdminSkuPricesView,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import { adminCatalogSkuSummarySchema, z } from "@freshmarkets/validation";
import { Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useAdminCommandIntent } from "./admin-command-state";
import { ListPageSection } from "./admin-shell";

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

export type ProductPriceSelection = {
  skuId: string;
  skuName: string;
  locationId: string;
  locationName: string;
};

function formatPrice(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || currency === null) return "Unavailable";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amountMinor / 100);
}

async function loadPrices(skuId: string, locationId: string) {
  const response = await fetch(
    `/api/admin/catalog/skus/${encodeURIComponent(skuId)}/prices?${new URLSearchParams({ locationId })}`,
  );
  return priceResultSchema.parse(await response.json());
}

export function GlobalPricePanel({
  skus,
  scopes,
  onEditPrice,
}: {
  skus: readonly AdminCatalogSkuSummary[];
  scopes: readonly AdminScopeOptionView[];
  onEditPrice: (selection: ProductPriceSelection) => void;
}) {
  const locations = scopes.filter((scope) => scope.kind === "location");
  const [skuId, setSkuId] = useState(skus[0]?.skuId ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.locationId ?? "");
  const [view, setView] = useState<AdminSkuPricesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let canceled = false;
    setView(null);
    setNotice(null);
    if (!skuId || !locationId) return;
    setLoading(true);
    void loadPrices(skuId, locationId)
      .then((result) => {
        if (canceled) return;
        if (result.ok) setView(result.value);
        else setNotice(`${result.error.message} Request reference: ${result.error.requestId}`);
      })
      .catch(() => {
        if (!canceled) setNotice("Price history could not be loaded. Retry to refresh it.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [skuId, locationId, reload]);

  const selectedSku = skus.find((sku) => sku.skuId === skuId);
  const selectedLocation = locations.find((location) => location.locationId === locationId);

  return (
    <ListPageSection
      title="Exact-location prices"
      description="Select a selling option and location to inspect its current final retail price and history."
    >
      <div className="space-y-4 p-4 text-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 font-medium">
            Selling option
            <Select value={skuId} onValueChange={setSkuId}>
              <SelectTrigger aria-label="Price variant" className="w-full">
                <SelectValue placeholder="Select selling option" />
              </SelectTrigger>
              <SelectContent>
                {skus.map((sku) => (
                  <SelectItem key={sku.skuId} value={sku.skuId}>
                    {sku.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 font-medium">
            Location
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger aria-label="Price location" className="w-full">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.locationId} value={location.locationId}>
                    {location.locationName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        {notice ? <p role="status">{notice}</p> : null}
        {!skuId || !locationId ? (
          <p className="text-[var(--fm-text-muted)]">
            Create a selling option and operational location before setting prices.
          </p>
        ) : loading ? (
          <p role="status">Loading price history…</p>
        ) : !view ? (
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            Retry price history
          </Button>
        ) : (
          <>
            <div className="grid items-center gap-3 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-4 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <p className="text-xs text-[var(--fm-text-muted)]">Selling option</p>
                <p className="mt-1 font-medium">{selectedSku?.name}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--fm-text-muted)]">Current price</p>
                <p className="mt-1 font-semibold">
                  {formatPrice(view.currentPriceMinor, view.currency)}
                </p>
              </div>
              {view.canManage && selectedSku && selectedLocation ? (
                <Button
                  type="button"
                  className="fm-admin-reference-primary"
                  onClick={() =>
                    onEditPrice({
                      skuId: selectedSku.skuId,
                      skuName: selectedSku.name,
                      locationId: selectedLocation.locationId,
                      locationName: selectedLocation.locationName,
                    })
                  }
                >
                  <Pencil aria-hidden="true" />
                  Edit price
                </Button>
              ) : (
                <span className="text-xs text-[var(--fm-text-muted)]">Read only</span>
              )}
            </div>
            <details>
              <summary className="cursor-pointer font-medium">Price history</summary>
              <ul className="mt-3 space-y-2" aria-label="Price history">
                {view.history.map((entry) => (
                  <li
                    key={entry.version}
                    className="rounded-md bg-[var(--fm-admin-surface-muted)] p-3"
                  >
                    {formatPrice(entry.amountMinor, entry.currency)} ·{" "}
                    {new Date(entry.validFrom).toLocaleString()} →{" "}
                    {entry.validTo === null ? "open end" : new Date(entry.validTo).toLocaleString()}
                  </li>
                ))}
              </ul>
              {view.history.length === 0 ? (
                <p className="mt-3 text-[var(--fm-text-muted)]">
                  No price has been recorded at this location.
                </p>
              ) : null}
            </details>
          </>
        )}
      </div>
    </ListPageSection>
  );
}

export function LocationPriceEditor({
  selection,
  onClose,
  onSaved,
}: {
  selection: ProductPriceSelection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [view, setView] = useState<AdminSkuPricesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [command, setCommand] = useState<PriceCommand | null>(null);
  const [reload, setReload] = useState(0);
  const intent = useAdminCommandIntent();

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setView(null);
    void loadPrices(selection.skuId, selection.locationId)
      .then((result) => {
        if (canceled) return;
        if (result.ok) setView(result.value);
        else setNotice(`${result.error.message} Request reference: ${result.error.requestId}`);
      })
      .catch(() => {
        if (!canceled) setNotice("The location price could not be loaded. Retry to continue.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [selection, reload]);

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
          const parsed: RpcResult<unknown> = commandResultSchema.parse(await response.json());
          return parsed;
        });
        setCommand(null);
        if (result.ok) {
          setNotice("Exact-location price saved.");
          setAmount("");
          setReload((value) => value + 1);
          onSaved();
        } else {
          setNotice(`${result.error.message} Request reference: ${result.error.requestId}`);
        }
      } catch {
        setNotice("The price could not be confirmed. Select Save price to try again.");
      }
    },
    [intent, onSaved],
  );

  function prepareCommand() {
    if (!view) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setNotice("Enter a positive price with at most two decimal places.");
      return null;
    }
    const [whole, fraction = ""] = amount.split(".");
    const amountMinor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    const validFrom = effectiveAt ? new Date(effectiveAt).getTime() : Date.now();
    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      !Number.isSafeInteger(validFrom)
    ) {
      setNotice("Enter a valid price and effective time.");
      return null;
    }
    return {
      skuId: selection.skuId,
      locationId: selection.locationId,
      marketId: view.marketId,
      currency: view.currency,
      amountMinor,
      validFrom,
      expectedVersion: view.latestVersion,
    } satisfies PriceCommand;
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div>
          <h2 id="location-price-panel-title" className="text-xl font-bold tracking-[-0.03em]">
            Edit location price
          </h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Update this selling option at one location.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close price editor"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <form
        id="location-price-form"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
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
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        <label className="grid gap-1 text-sm font-medium">
          Location
          <Input value={selection.locationName} readOnly />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Selling option
          <Input value={selection.skuName} readOnly />
        </label>
        {loading ? (
          <p role="status">Loading location price…</p>
        ) : !view ? (
          <Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>
            Retry location price
          </Button>
        ) : (
          <>
            <label className="grid gap-1 text-sm font-medium">
              Current price
              <Input value={formatPrice(view.currentPriceMinor, view.currency)} readOnly />
            </label>
            {view.canManage ? (
              <>
                <label className="grid gap-1 text-sm font-medium">
                  New price ({view.currency})
                  <Input
                    aria-label="Final retail price"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    disabled={command !== null}
                    required
                  />
                  <span className="text-xs font-normal text-[var(--fm-text-muted)]">
                    Enter the final customer price for this location and selling option.
                  </span>
                </label>
                <details className="border-t border-[var(--fm-border)] pt-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Schedule this price change
                  </summary>
                  <label className="mt-3 grid gap-1 text-sm font-medium">
                    Effective time (your local time)
                    <Input
                      aria-label="Price effective time"
                      type="datetime-local"
                      value={effectiveAt}
                      onChange={(event) => setEffectiveAt(event.target.value)}
                      disabled={command !== null}
                    />
                  </label>
                </details>
              </>
            ) : (
              <p className="text-sm text-[var(--fm-text-muted)]">
                Read only. Global price-management permission is required to set prices.
              </p>
            )}
          </>
        )}
      </form>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {view?.canManage ? (
          <Button
            type="submit"
            form="location-price-form"
            className="fm-admin-reference-primary"
            disabled={intent.pending || loading}
          >
            {intent.pending ? "Saving price…" : "Save price"}
          </Button>
        ) : null}
      </div>
    </>
  );
}
