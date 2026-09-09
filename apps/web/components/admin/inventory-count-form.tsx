"use client";
import { useEffect, useState } from "react";
import type { AdminInventoryItem, AdminProductDetail } from "@freshmarkets/contracts";
import { z, adminProductDetailSchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import { useAdminCommand } from "./use-admin-command";

export function InventoryCountForm({
  item,
  onSaved,
}: {
  item: AdminInventoryItem;
  onSaved: () => void;
}) {
  const { state } = useAdminContext();
  const locationScope =
    state.phase === "ready"
      ? state.scopes.find(
          (scope) => scope.kind === "location" && scope.locationId === item.locationId,
        )
      : null;
  const marketId = locationScope?.kind === "location" ? locationScope.marketId : null;
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<AdminProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grams, setGrams] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const command = useAdminCommand();
  useEffect(() => {
    if (!open || !marketId) return;
    const controller = new AbortController();
    setProduct(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/catalog/products/${encodeURIComponent(item.productId)}?scopeKind=LOCATION&marketId=${encodeURIComponent(marketId)}&locationId=${encodeURIComponent(item.locationId)}`,
          { signal: controller.signal },
        );
        const result = z
          .discriminatedUnion("ok", [
            z.object({ ok: z.literal(true), value: adminProductDetailSchema }),
            z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
          ])
          .parse(await response.json());
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) setProduct(result.value);
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load product sizes");
      }
    })();
    return () => controller.abort();
  }, [open, item.productId, item.locationId, marketId]);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Count sizes
      </Button>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (!command.busy && !command.uncertain) setOpen(value);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Count sizes: {item.productName}</SheetTitle>
            <SheetDescription>
              Count the pieces or packs from the measured bulk goods. This moves the same goods into
              their actual size counts; it does not add another receipt.
            </SheetDescription>
          </SheetHeader>
          {error ? (
            <p role="alert">{error}</p>
          ) : !product ? (
            <p role="status">Loading sizes…</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  const saved = command.uncertain
                    ? await command.retry()
                    : await command.run(
                        `sort:${item.inventoryPoolId}`,
                        "/api/admin/inventory/sort",
                        {
                          productId: item.productId,
                          locationId: item.locationId,
                          quantityGrams: Number(grams),
                          expectedVersion: item.version,
                          reason,
                          sizeCounts: product.skus
                            .filter((sku) => sku.stockPoolId && Number(counts[sku.skuId] ?? 0) > 0)
                            .map((sku) => ({
                              skuId: sku.skuId,
                              quantity: Number(counts[sku.skuId]),
                            })),
                        },
                      );
                  if (saved) {
                    setOpen(false);
                    setGrams("");
                    setCounts({});
                    setReason("");
                    onSaved();
                  }
                })();
              }}
            >
              <fieldset disabled={command.busy || command.uncertain} className="space-y-3">
                <label className="block space-y-1 text-sm">
                  Measured grams being counted
                  <Input
                    type="number"
                    min="1"
                    max={item.availableBase ?? item.onHandBase}
                    step="1"
                    value={grams}
                    onChange={(event) => setGrams(event.target.value)}
                    required
                  />
                </label>
                {product.skus
                  .filter((sku) => sku.stockPoolId && sku.status === "active")
                  .map((sku) => (
                    <label className="block space-y-1 text-sm" key={sku.skuId}>
                      {sku.name} pieces/packs
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={counts[sku.skuId] ?? ""}
                        onChange={(event) =>
                          setCounts((current) => ({ ...current, [sku.skuId]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                <label className="block space-y-1 text-sm">
                  Reason
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    maxLength={500}
                  />
                </label>
              </fieldset>
              <Button type="submit" disabled={command.busy}>
                {command.busy ? "Saving…" : "Save counts"}
              </Button>
            </form>
          )}
          {command.notice ? <p role="status">{command.notice}</p> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
