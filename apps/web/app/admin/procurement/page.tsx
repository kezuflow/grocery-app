"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ScheduledWeekView, ScheduledDemandItem } from "@freshmarkets/contracts";
import { z, scheduledWeekViewSchema } from "@freshmarkets/validation";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import { useAdminCommand } from "../../../components/admin/use-admin-command";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: scheduledWeekViewSchema }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
const sectionNames = {
  DEMAND: "Quantities to buy",
  ORDERS: "Paid orders",
  OFFERS: "Offered products",
} as const;
const plain = (value: string) => value.toLowerCase().replaceAll("_", " ");
const amount = (quantity: number, unit: string) =>
  `${quantity.toLocaleString("en-PH")} ${unit === "GRAM" ? "g" : "pieces/packs"}`;
export default function ProcurementPage() {
  const { locationId, label } = useAdminLocation();
  const [cycleId, setCycleId] = useState("");
  const [cycleCursor, setCycleCursor] = useState("");
  const [cycles, setCycles] = useState<ScheduledWeekView["cycles"]>([]);
  const [section, setSection] = useState<"DEMAND" | "ORDERS" | "OFFERS">("DEMAND");
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<ScheduledWeekView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{
    item: ScheduledDemandItem;
    locationId: string;
    cycleId: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const command = useAdminCommand();
  useEffect(() => {
    setCycleId("");
    setCycleCursor("");
    setCycles([]);
    setCursor("");
    setPrevious([]);
  }, [locationId]);
  useEffect(() => {
    setView(null);
    setError(null);
    if (!locationId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ locationId, section });
    if (cycleId) params.set("cycleId", cycleId);
    if (cycleCursor) params.set("cycleCursor", cycleCursor);
    if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/procurement/week?${params}`, {
          signal: controller.signal,
        });
        const result = responseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setView(result.value);
        setCycles((current) =>
          Array.from(
            new Map(
              [...current, ...result.value.cycles].map((cycle) => [cycle.cycleId, cycle]),
            ).values(),
          ),
        );
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load this delivery week");
      }
    })();
    return () => controller.abort();
  }, [locationId, cycleId, cycleCursor, section, cursor, reload]);
  const date = (value: number | null) =>
    value === null
      ? "Not set"
      : new Intl.DateTimeFormat("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: view?.week?.timezone ?? "Asia/Manila",
        }).format(value);
  const resetPage = () => {
    setCursor("");
    setPrevious([]);
  };
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Delivery week"
        description={`Dates, paid orders, purchases and receiving · ${label}`}
      />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/admin/settings/delivery-cycles">Manage delivery dates</Link>
        </Button>
        <Button asChild variant="outline">
          <Link
            href={
              cycleId
                ? `/admin/receiving?cycleId=${encodeURIComponent(cycleId)}`
                : "/admin/receiving"
            }
          >
            Receiving
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/fulfillment">Preparation</Link>
        </Button>
      </div>
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location in the Admin header to review its delivery weeks."
        />
      ) : (
        <>
          <label className="grid max-w-lg gap-2 text-sm font-medium">
            Delivery week
            <select
              aria-label="Delivery week"
              className="h-10 rounded border bg-background px-3"
              value={cycleId}
              disabled={command.busy || command.uncertain}
              onChange={(event) => {
                setCycleId(event.target.value);
                resetPage();
              }}
            >
              <option value="">Select a delivery week</option>
              {cycles.map((cycle) => (
                <option key={cycle.cycleId} value={cycle.cycleId}>
                  {cycle.name} · {plain(cycle.status)}
                </option>
              ))}
            </select>
          </label>
          {view?.nextCycleCursor ? (
            <Button variant="outline" onClick={() => setCycleCursor(view.nextCycleCursor ?? "")}>
              More delivery weeks
            </Button>
          ) : null}
          {error ? (
            <div role="alert">
              {error}{" "}
              <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
                Reload
              </Button>
            </div>
          ) : !view ? (
            <p role="status">Loading delivery week…</p>
          ) : null}
          {view?.week ? (
            <>
              <section className="rounded-lg border p-4" aria-label="Delivery week dates">
                <h2 className="text-lg font-semibold">{view.week.name}</h2>
                <p>
                  {plain(view.week.status)} · {view.week.timezone}
                </p>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Ordering opens", view.week.orderOpensAt],
                    ["Order cutoff", view.week.cutoffAt],
                    ["Purchase planned", view.week.procurementAt],
                    ["Preparation planned", view.week.preparationAt],
                    ["Pickup planned", view.week.pickupAt],
                  ].map(([name, value]) => (
                    <div key={String(name)}>
                      <dt className="text-sm text-muted-foreground">{name}</dt>
                      <dd>{date(typeof value === "number" ? value : null)}</dd>
                    </div>
                  ))}
                </dl>
                {view.week.windows.map((window) => (
                  <p className="mt-3 text-sm" key={window.name}>
                    {window.name}: {date(window.startsAt)} – {date(window.endsAt)}
                  </p>
                ))}
              </section>
              <nav aria-label="Delivery week sections" className="flex flex-wrap gap-2">
                {(Object.keys(sectionNames) as Array<keyof typeof sectionNames>).map((kind) => (
                  <Button
                    key={kind}
                    variant={section === kind ? "default" : "outline"}
                    onClick={() => {
                      setSection(kind);
                      resetPage();
                    }}
                  >
                    {sectionNames[kind]}
                  </Button>
                ))}
              </nav>
              <section className="space-y-3" aria-label={sectionNames[view.page.kind]}>
                <h2 className="text-lg font-semibold">{sectionNames[view.page.kind]}</h2>
                {view.page.kind === "DEMAND" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Paid quantities include paid additions and exclude accepted cancellations.
                      Contact your supplier outside FreshMarkets, then confirm what you bought.
                      Physical stock is not subtracted from this list.
                    </p>
                    {view.page.items.length === 0 ? (
                      <p>No paid quantities to buy for this week.</p>
                    ) : (
                      view.page.items.map((item) => (
                        <article
                          key={item.skuId}
                          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto]"
                        >
                          <div>
                            <h3 className="font-semibold">
                              {item.productName} · {item.variantName}
                            </h3>
                            <p>
                              {item.quantitySellable.toLocaleString("en-PH")} sold units ·{" "}
                              {amount(item.quantityBase, item.baseUnit)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Recorded shipping weight: {item.shippingGrams.toLocaleString("en-PH")}{" "}
                              g
                            </p>
                            <p className="mt-2 text-sm">
                              Accepted {amount(item.acceptedBase, item.baseUnit)} · rejected{" "}
                              {amount(item.rejectedBase, item.baseUnit)}
                            </p>
                            <StatusBadge>{plain(item.status)}</StatusBadge>
                            {item.shortageBase > 0 ? (
                              <p className="text-sm">
                                Reported missing: {amount(item.shortageBase, item.baseUnit)}
                              </p>
                            ) : null}
                            {item.replacementBase > 0 ? (
                              <p className="text-sm">
                                Replacement goods accepted:{" "}
                                {amount(item.replacementBase, item.baseUnit)}
                              </p>
                            ) : null}
                            {item.receivingStatus ? (
                              <span className="ml-2 text-sm">
                                Receiving: {plain(item.receivingStatus)}
                              </span>
                            ) : null}
                          </div>
                          {item.canConfirmPurchase ? (
                            <Button
                              disabled={command.busy || command.uncertain}
                              onClick={() => {
                                setNote("");
                                setPurchase({ item, locationId, cycleId });
                              }}
                            >
                              Confirm purchase
                            </Button>
                          ) : null}
                        </article>
                      ))
                    )}
                  </>
                ) : view.page.kind === "ORDERS" ? (
                  view.page.denied ? (
                    <p>Order and preparation access is not available for this scope.</p>
                  ) : view.page.items.length === 0 ? (
                    <p>No paid orders recorded for this week.</p>
                  ) : (
                    view.page.items.map((order, index) => (
                      <article
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                        key={order.orderId}
                      >
                        <Link
                          href={`/admin/orders/${encodeURIComponent(order.orderId)}`}
                          className="underline"
                        >
                          View order {index + 1}
                        </Link>
                        <span>
                          {plain(order.status)} · Preparation:{" "}
                          {order.preparationStatus ? plain(order.preparationStatus) : "not started"}
                        </span>
                      </article>
                    ))
                  )
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Currently enabled selling options at this location. Product and price changes
                      do not rewrite paid orders.
                    </p>
                    {view.page.items.length === 0 ? (
                      <p>No products are enabled at this location.</p>
                    ) : (
                      view.page.items.map((item) => (
                        <article
                          className="flex flex-wrap justify-between gap-3 rounded-lg border p-4"
                          key={item.skuId}
                        >
                          <span>
                            {item.productName} · {item.variantName}
                          </span>
                          <span>
                            {item.priceMinor === null || !item.currency
                              ? "Price unavailable"
                              : new Intl.NumberFormat("en-PH", {
                                  style: "currency",
                                  currency: item.currency,
                                }).format(item.priceMinor / 100)}
                          </span>
                        </article>
                      ))
                    )}
                  </>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={previous.length === 0}
                    onClick={() => {
                      setCursor(previous.at(-1) ?? "");
                      setPrevious((values) => values.slice(0, -1));
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!view.page.nextCursor}
                    onClick={() => {
                      setPrevious((values) => [...values, cursor]);
                      setCursor(view.page.nextCursor ?? "");
                    }}
                  >
                    Next
                  </Button>
                </div>
              </section>
            </>
          ) : view && !error ? (
            <p>Choose a named delivery week to review its work.</p>
          ) : null}
        </>
      )}
      <Sheet
        open={purchase !== null}
        onOpenChange={(open) => {
          if (!open && !command.busy && !command.uncertain) setPurchase(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Confirm purchase</SheetTitle>
            <SheetDescription>
              Record the supplier purchase for these exact paid quantities.
            </SheetDescription>
          </SheetHeader>
          {purchase ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  const saved = command.uncertain
                    ? await command.retry()
                    : await command.run(
                        `purchase:${purchase.cycleId}:${purchase.item.skuId}`,
                        "/api/admin/procurement/purchase",
                        {
                          locationId: purchase.locationId,
                          cycleId: purchase.cycleId,
                          skuId: purchase.item.skuId,
                          inventoryPoolId: purchase.item.inventoryPoolId,
                          expectedVersion: purchase.item.requirementVersion,
                          expectedQuantityBase: purchase.item.quantityBase,
                          expectedQuantitySellable: purchase.item.quantitySellable,
                          reason: note.trim() || "Supplier purchase confirmed",
                        },
                      );
                  if (saved) {
                    setPurchase(null);
                    setReload((value) => value + 1);
                  }
                })();
              }}
            >
              <p className="font-semibold">
                {purchase.item.productName} · {purchase.item.variantName}
              </p>
              <p>
                {purchase.item.quantitySellable} sold units ·{" "}
                {amount(purchase.item.quantityBase, purchase.item.baseUnit)}
              </p>
              <label className="grid gap-2 text-sm">
                Purchase note (optional)
                <Input
                  value={note}
                  maxLength={500}
                  disabled={command.busy || command.uncertain}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={command.busy}>
                {command.busy ? "Saving…" : "Confirm purchase"}
              </Button>
              {command.notice ? <p role="status">{command.notice}</p> : null}
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
