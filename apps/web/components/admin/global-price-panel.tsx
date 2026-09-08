"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminCatalogSkuSummary,
  AdminScopeOptionView,
  AdminSkuPricesView,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ListPageSection } from "./admin-shell";
import { useAdminCommandIntent } from "./admin-command-state";
import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { adminCatalogSkuSummarySchema } from "@freshmarkets/validation";

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

export function GlobalPricePanel({
  skus,
  scopes,
}: {
  skus: readonly AdminCatalogSkuSummary[];
  scopes: readonly AdminScopeOptionView[];
}) {
  const locations = scopes.filter((scope) => scope.kind === "location");
  const [skuId, setSkuId] = useState(skus[0]?.skuId ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.locationId ?? "");
  const [view, setView] = useState<AdminSkuPricesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [command, setCommand] = useState<PriceCommand | null>(null);
  const [reload, setReload] = useState(0);
  const intent = useAdminCommandIntent();

  useEffect(() => {
    let canceled = false;
    setView(null);
    setAmount("");
    setEffectiveAt("");
    if (!skuId || !locationId) return;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/catalog/skus/${encodeURIComponent(skuId)}/prices?${new URLSearchParams({ locationId })}`,
        );
        const result = priceResultSchema.parse(await response.json());
        if (canceled) return;
        if (result.ok) setView(result.value);
        else setNotice(result.error.message);
      } catch {
        if (!canceled) setNotice("Price history could not be loaded. Retry to refresh it.");
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [skuId, locationId, reload]);

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
          const result: RpcResult<unknown> = commandResultSchema.parse(await response.json());
          return result;
        });
        setCommand(null);
        setNotice(result.ok ? "Exact-location price saved." : result.error.message);
        setReload((value) => value + 1);
      } catch {
        setNotice("The price could not be confirmed. Select Save price to try again.");
      }
    },
    [intent],
  );

  return (
    <ListPageSection
      title="Exact-location prices"
      description="Set a final retail price for each location. Missing prices remain unavailable. History shows the latest 25 versions."
    >
      <div className="space-y-4 p-4 text-sm">
        <div className="flex flex-wrap gap-3">
          <Select value={skuId} onValueChange={setSkuId} disabled={command !== null}>
            <SelectTrigger aria-label="Price variant" className="w-64">
              <SelectValue placeholder="Select variant" />
            </SelectTrigger>
            <SelectContent>
              {skus.map((sku) => (
                <SelectItem key={sku.skuId} value={sku.skuId}>
                  {sku.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationId} onValueChange={setLocationId} disabled={command !== null}>
            <SelectTrigger aria-label="Price location" className="w-64">
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
        </div>
        {notice ? <p role="status">{notice}</p> : null}
        {!skuId || !locationId ? (
          <p>Create a variant and an operational location before setting prices.</p>
        ) : loading ? (
          <p role="status">Loading price history…</p>
        ) : !view ? (
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            Retry price history
          </Button>
        ) : (
          <>
            <p>
              Current price:{" "}
              {view.currentPriceMinor === null
                ? "Unavailable"
                : new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: view.currency,
                  }).format(view.currentPriceMinor / 100)}
            </p>
            {view.canManage ? (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (command) {
                    void submit(command);
                    return;
                  }
                  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
                    setNotice("Enter a positive price with at most two decimal places.");
                    return;
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
                    return;
                  }
                  void submit({
                    skuId,
                    locationId,
                    marketId: view.marketId,
                    currency: view.currency,
                    amountMinor,
                    validFrom,
                    expectedVersion: view.latestVersion,
                  });
                }}
              >
                <label className="space-y-1">
                  Final price ({view.currency})
                  <Input
                    aria-label="Final retail price"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    disabled={command !== null}
                    required
                  />
                </label>
                <details>
                  <summary className="cursor-pointer">Schedule a price change</summary>
                  <label className="space-y-1">
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
                <Button type="submit" disabled={intent.pending}>
                  {intent.pending ? "Saving price…" : "Save price"}
                </Button>
              </form>
            ) : (
              <p>Read only. Global price-management permission is required to set prices.</p>
            )}
            <details>
              <summary className="cursor-pointer">Price history</summary>
              <ul className="space-y-2" aria-label="Price history">
                {view.history.map((price) => (
                  <li key={price.version}>
                    {new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: price.currency,
                    }).format(price.amountMinor / 100)}{" "}
                    · {new Date(price.validFrom).toLocaleString()} →{" "}
                    {price.validTo === null ? "open end" : new Date(price.validTo).toLocaleString()}
                  </li>
                ))}
              </ul>
              {view.history.length === 0 ? (
                <p>No price has been recorded at this location.</p>
              ) : null}
            </details>
          </>
        )}
      </div>
    </ListPageSection>
  );
}
