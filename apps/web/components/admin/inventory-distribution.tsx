"use client";
import { useEffect, useState } from "react";
import { z, inventoryDistributionPageSchema } from "@freshmarkets/validation";
import type { InventoryDistributionPage } from "@freshmarkets/contracts";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { AdminCursorPagination, useAdminPagination } from "./admin-controls";

export function InventoryDistribution() {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; page: InventoryDistributionPage } | null>(
      null,
    ),
    [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState(false),
    [reload, setReload] = useState(0);
  const pagination = useAdminPagination(search);
  const readKey = JSON.stringify([expanded, search, pagination.cursor, reload]);
  const page = loaded?.key === readKey ? loaded.page : null;
  const visibleError = error?.key === readKey ? error.message : null;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController(),
      params = new URLSearchParams({ query: search });
    if (pagination.cursor) params.set("cursor", pagination.cursor);
    setLoaded(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/inventory-distribution?${params}`, {
          signal: controller.signal,
        });
        const result = z
          .discriminatedUnion("ok", [
            z.object({ ok: z.literal(true), value: inventoryDistributionPageSchema }),
            z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
          ])
          .parse(await response.json());
        if (!result.ok) throw new Error(result.error.message);
        if (!controller.signal.aborted) setLoaded({ key: readKey, page: result.value });
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setError({
            key: readKey,
            message: error instanceof Error ? error.message : "Unable to load stock distribution",
          });
      }
    })();
    return () => controller.abort();
  }, [expanded, search, pagination.cursor, reload, readKey]);
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="Global stock distribution">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Stock distribution</h2>
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls="inventory-distribution-content"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide distribution" : "View distribution"}
          <ChevronDown aria-hidden="true" className="fm-disclosure-chevron size-4" />
        </Button>
      </div>
      <div
        id="inventory-distribution-content"
        data-open={expanded}
        className="fm-disclosure-panel"
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="fm-disclosure-panel-inner min-h-0 space-y-4 overflow-hidden">
          <p className="text-sm">
            Physical stock is held at warehouses and fulfillment sites. Reservations and holds are
            included in physical stock. Damaged and missing goods below are included in transit, not
            added to it.
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query);
              setReload((value) => value + 1);
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="distribution-search">Distribution product search</Label>
              <Input
                id="distribution-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button type="submit">Find stock</Button>
          </form>
          {visibleError ? (
            <p role="alert">{visibleError}</p>
          ) : !page ? (
            <p role="status">Loading stock distribution…</p>
          ) : (
            <>
              {!page.items.length ? (
                <p>No products match this search.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {page.items.map((item) => (
                    <article key={item.inventoryPoolId} className="space-y-3 rounded border p-3">
                      <h3 className="font-medium">
                        {item.productName}{" "}
                        <span className="text-sm text-muted-foreground">
                          ({item.baseUnit === "GRAM" ? "grams" : "pieces"})
                        </span>
                      </h3>
                      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        {[
                          ["Central stock", item.centralBase],
                          ["Site stock", item.localBase],
                          ["Total physical stock", item.physicalBase],
                          ["Reserved", item.reservedBase],
                          ["Checkout holds", item.heldBase],
                          ["Outstanding transit", item.transitBase],
                          ["Damaged / non-sellable", item.damagedBase],
                          ["Missing", item.shortageBase],
                        ].map(([label, quantity]) => (
                          <div key={label}>
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd className="font-medium">
                              {typeof quantity === "number"
                                ? `${quantity.toLocaleString("en-PH")} ${item.baseUnit === "GRAM" ? "g" : "pieces"}`
                                : quantity}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
              )}
              <AdminCursorPagination
                pageNumber={pagination.pageNumber}
                nextCursor={page.nextCursor}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
