"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { AdminCursorPagination, AdminIndexViews } from "../../../components/admin/admin-controls";
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import { useAdminContext } from "../admin-context-provider";
import { useAdminCommand } from "../../../components/admin/use-admin-command";
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { ScheduledOrderSummary } from "../../../components/admin/scheduled-order-summary";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: scheduledWeekViewSchema }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
const sectionNames = {
  ORDER_SUMMARY: "Order summary",
  DEMAND: "Quantities to buy",
  ORDERS: "Paid orders",
  OFFERS: "Offered products",
} as const;
const plain = (value: string) => value.toLowerCase().replaceAll("_", " ");
const amount = (quantity: number, unit: string) =>
  `${quantity.toLocaleString("en-PH")} ${unit === "GRAM" ? "g" : unit === "MILLILITER" ? "mL" : "pcs"}`;
const purchaseVersionKey = (cycleId: string, item: ScheduledDemandItem) =>
  JSON.stringify([
    cycleId,
    item.locationId,
    item.skuId,
    item.inventoryPoolId,
    item.requirementVersion,
  ]);
export default function ProcurementPage() {
  const { locationId, label } = useAdminLocation();
  const { state } = useAdminContext();
  const global = state.phase === "ready" && state.selectedScope?.kind === "GLOBAL";
  const capabilities = state.phase === "ready" ? state.context.capabilities : [];
  const canReceive = Boolean(locationId) && capabilities.includes("procurement.manage");
  const canManageCycles =
    global &&
    (capabilities.includes("fulfillment.read") || capabilities.includes("fulfillment.manage"));
  const canPrepare =
    Boolean(locationId) &&
    (capabilities.includes("fulfillment.read") || capabilities.includes("fulfillment.manage"));
  const search = useSearchParams();
  const linkedCycleId = search.get("cycleId") ?? "";
  const linkedRequirementId = search.get("requirementId") ?? "";
  const linkedLocationId = search.get("locationId") ?? "";
  const [requirementId, setRequirementId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [cycleCursor, setCycleCursor] = useState("");
  const [cycleOptions, setCycleOptions] = useState<{
    scopeKey: string;
    items: ScheduledWeekView["cycles"];
  }>({ scopeKey: "", items: [] });
  const [section, setSection] = useState<"ORDER_SUMMARY" | "DEMAND" | "ORDERS" | "OFFERS">(
    "ORDER_SUMMARY",
  );
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [fetchedView, setFetchedView] = useState<ScheduledWeekView | null>(null);
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const [weekSnapshot, setWeekSnapshot] = useState<{
    key: string;
    week: ScheduledWeekView["week"];
  } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [purchase, setPurchase] = useState<{
    item: ScheduledDemandItem;
    locationId: string;
    cycleId: string;
  } | null>(null);
  const [note, setNote] = useState("");
  const [confirmedPurchaseKey, setConfirmedPurchaseKey] = useState<string | null>(null);
  const command = useAdminCommand();
  useAdminRouteGuard(false, command.busy || command.uncertain);
  const scopeKey = global ? "GLOBAL" : (locationId ?? "NONE");
  const selectedWeekKey = `${scopeKey}:${cycleId}`;
  const readKey = JSON.stringify([scopeKey, cycleId, cycleCursor, section, cursor, requirementId]);
  const view = fetchedKey === readKey ? fetchedView : null;
  const week = weekSnapshot?.key === selectedWeekKey ? weekSnapshot.week : null;
  const cycles = cycleOptions.scopeKey === scopeKey ? cycleOptions.items : [];
  const visibleError = error?.key === readKey ? error.message : null;
  useEffect(() => {
    const linked = locationId === linkedLocationId && !!linkedCycleId && !!linkedRequirementId;
    setCycleId(linked ? linkedCycleId : "");
    setRequirementId(linked ? linkedRequirementId : "");
    setCycleCursor("");
    setCycleOptions({ scopeKey, items: [] });
    setCursor("");
    setPrevious([]);
    setSection(linked ? "ORDERS" : "ORDER_SUMMARY");
  }, [locationId, global, linkedCycleId, linkedRequirementId, linkedLocationId, scopeKey]);
  useEffect(() => {
    setError(null);
    if (!locationId && !global) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ section });
    if (locationId) params.set("locationId", locationId);
    if (cycleId) params.set("cycleId", cycleId);
    if (cycleCursor) params.set("cycleCursor", cycleCursor);
    if (cursor) params.set("cursor", cursor);
    if (requirementId && section === "ORDERS" && !global)
      params.set("requirementId", requirementId);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/procurement/week?${params}`, {
          signal: controller.signal,
        });
        const result = responseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setError({ key: readKey, message: result.error.message });
          return;
        }
        setFetchedView(result.value);
        setFetchedKey(readKey);
        setWeekSnapshot({ key: selectedWeekKey, week: result.value.week });
        setCycleOptions((current) => ({
          scopeKey,
          items: Array.from(
            new Map(
              [...(current.scopeKey === scopeKey ? current.items : []), ...result.value.cycles].map(
                (cycle) => [cycle.cycleId, cycle],
              ),
            ).values(),
          ),
        }));
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setError({
            key: readKey,
            message: error instanceof Error ? error.message : "Unable to load this delivery week",
          });
      }
    })();
    return () => controller.abort();
  }, [
    locationId,
    global,
    cycleId,
    cycleCursor,
    section,
    cursor,
    requirementId,
    reload,
    readKey,
    selectedWeekKey,
    scopeKey,
  ]);
  useEffect(() => {
    if (!week?.purchaseBlockedReason || visibleError) return;
    const timer = setTimeout(() => setReload((value) => value + 1), 5000);
    return () => clearTimeout(timer);
  }, [week, visibleError]);
  const date = (value: number | null) =>
    value === null
      ? "Not set"
      : new Intl.DateTimeFormat("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: week?.timezone ?? "Asia/Manila",
        }).format(value);
  const resetPage = () => {
    setCursor("");
    setPrevious([]);
  };
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Delivery weeks"
        description={
          global
            ? "Review paid demand and purchase quantities across destinations."
            : `Review the customer arrival plan and operational work for ${label}.`
        }
        action={
          canManageCycles ? (
            <Button asChild variant="outline">
              <Link href="/admin/settings/scheduled-cycles">Manage Scheduled cycles</Link>
            </Button>
          ) : null
        }
      />
      {!locationId && !global ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location in the Admin header to review its delivery weeks."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-4 shadow-[var(--fm-shadow-card)]">
            <label className="grid min-w-60 max-w-lg flex-1 gap-2 text-sm font-medium">
              Delivery week
              <select
                aria-label="Delivery week"
                className="h-10 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-3"
                value={cycleId}
                disabled={command.busy || command.uncertain}
                onChange={(event) => {
                  setCycleId(event.target.value);
                  setRequirementId("");
                  setSection("ORDER_SUMMARY");
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
          </div>
          {visibleError ? (
            <div
              role="alert"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-danger-border)] bg-[var(--fm-danger-soft)] p-4 text-sm"
            >
              {visibleError}{" "}
              <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
                Reload
              </Button>
            </div>
          ) : !view && !week ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-4 text-sm"
            >
              Loading delivery week…
            </p>
          ) : null}
          {week ? (
            <>
              <section
                className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-4 shadow-[var(--fm-shadow-card)] sm:p-5"
                aria-label="Delivery week dates"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">{week.name}</h2>
                  <StatusBadge>{plain(week.status)}</StatusBadge>
                  <span className="text-xs text-[var(--fm-text-muted)]">{week.timezone}</span>
                </div>
                <div className="mt-4 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
                    Customer arrival
                  </h3>
                  {week.windows.length === 0 ? (
                    <p className="mt-2 text-sm">No customer delivery range recorded.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {week.windows.map((window) => (
                        <li key={`${window.name}:${window.startsAt}`} className="text-sm">
                          {week.windows.length > 1 ? (
                            <span className="font-medium">{window.name}: </span>
                          ) : null}
                          <span className="font-semibold">
                            {date(window.startsAt)} – {date(window.endsAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <h3 className="mt-5 text-sm font-semibold">Operational schedule</h3>
                <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Ordering opens", week.orderOpensAt],
                    ["Order cutoff", week.cutoffAt],
                    ["Purchase planned", week.procurementAt],
                    ["Preparation planned", week.preparationAt],
                    ["Pickup planned", week.pickupAt],
                  ].map(([name, value]) => (
                    <div key={String(name)}>
                      <dt className="text-[var(--fm-text-muted)]">{name}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {date(typeof value === "number" ? value : null)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {canReceive || canPrepare ? (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--fm-border)] pt-4">
                    {canReceive ? (
                      <Button asChild variant="outline">
                        <Link href={`/admin/receiving?cycleId=${encodeURIComponent(cycleId)}`}>
                          Receiving
                        </Link>
                      </Button>
                    ) : null}
                    {canPrepare ? (
                      <Button asChild variant="outline">
                        <Link href="/admin/fulfillment">Preparation</Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>
              {week.purchaseBlockedReason ? (
                <p role="status" className="rounded-lg border p-3 text-sm">
                  {week.purchaseBlockedReason}
                </p>
              ) : null}
              <AdminIndexViews
                label="Delivery week sections"
                views={(Object.keys(sectionNames) as Array<keyof typeof sectionNames>)
                  .filter((kind) => !global || ["ORDER_SUMMARY", "DEMAND"].includes(kind))
                  .map((kind) => ({ label: sectionNames[kind], status: kind }))}
                value={section}
                disabled={command.busy || command.uncertain}
                onChange={(kind) => {
                  setSection(kind);
                  resetPage();
                }}
              />
              {view ? (
                <ListPageSection title={sectionNames[view.page.kind]}>
                  <div className="space-y-3 p-4 sm:p-5">
                    {view.page.kind === "ORDERS" && view.page.requirement ? (
                      <div className="space-y-2">
                        <p>
                          Affected orders: {view.page.requirement.productName} ·{" "}
                          {view.page.requirement.variantName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          If replacement goods cannot be sourced, an authorized Global administrator
                          can open an Order and cancel it with a reason. Refund progress is separate
                          from quantities still owed.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRequirementId("");
                            resetPage();
                          }}
                        >
                          Show all orders
                        </Button>
                      </div>
                    ) : null}
                    {view.page.kind === "ORDER_SUMMARY" ? (
                      <ScheduledOrderSummary
                        items={view.page.items}
                        totals={view.page.totals}
                        global={global}
                      />
                    ) : view.page.kind === "DEMAND" ? (
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
                              key={JSON.stringify([
                                item.skuId,
                                item.inventoryPoolId,
                                item.locationId,
                              ])}
                              className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto]"
                            >
                              <div>
                                <h3 className="font-semibold">
                                  {item.productName} · {item.variantName}
                                </h3>
                                {global ? (
                                  <p className="text-sm">
                                    All destinations:{" "}
                                    {item.totalQuantitySellable.toLocaleString("en-PH")} sold units
                                    · {amount(item.totalQuantityBase, item.baseUnit)}
                                  </p>
                                ) : null}
                                <p className="mt-2 font-medium">{item.locationName}</p>
                                <p>
                                  {item.quantitySellable.toLocaleString("en-PH")} sold units ·{" "}
                                  {amount(item.quantityBase, item.baseUnit)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Recorded shipping weight:{" "}
                                  {item.shippingGrams.toLocaleString("en-PH")} g
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
                              {confirmedPurchaseKey === purchaseVersionKey(cycleId, item) ? (
                                <p role="status" className="text-sm">
                                  Purchase recorded. Refreshing current quantities.
                                </p>
                              ) : item.canConfirmPurchase ? (
                                <Button
                                  disabled={command.busy || command.uncertain}
                                  onClick={() => {
                                    setNote("");
                                    setPurchase({ item, locationId: item.locationId, cycleId });
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
                              {order.preparationStatus
                                ? plain(order.preparationStatus)
                                : "not started"}
                              {order.openQuantityBase !== null &&
                              view.page.kind === "ORDERS" &&
                              view.page.requirement ? (
                                <span className="block">
                                  {order.openQuantityBase === 0
                                    ? "Quantity released by cancellation"
                                    : `Order quantity: ${amount(order.openQuantityBase, view.page.requirement.baseUnit)}`}
                                </span>
                              ) : null}
                              {order.cancellationStatus ? (
                                <span className="block">
                                  Cancellation:{" "}
                                  {order.cancellationStatus === "COMPLETED"
                                    ? "refunds confirmed"
                                    : order.cancellationStatus === "EXCEPTION"
                                      ? "refund needs attention"
                                      : "refunds pending"}
                                </span>
                              ) : null}
                            </span>
                          </article>
                        ))
                      )
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Currently enabled selling options at this location. Product and price
                          changes do not rewrite paid orders.
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
                  </div>
                  <AdminCursorPagination
                    pageNumber={previous.length + 1}
                    nextCursor={view.page.nextCursor}
                    pending={command.busy || command.uncertain}
                    onPrevious={() => {
                      setCursor(previous.at(-1) ?? "");
                      setPrevious((values) => values.slice(0, -1));
                    }}
                    onNext={(nextCursor) => {
                      setPrevious((values) => [...values, cursor]);
                      setCursor(nextCursor);
                    }}
                  />
                </ListPageSection>
              ) : !visibleError ? (
                <p
                  role="status"
                  className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-4 text-sm"
                >
                  Loading {sectionNames[section].toLowerCase()}…
                </p>
              ) : null}
            </>
          ) : view && !visibleError ? (
            <AdminPageState
              state="empty"
              title="Choose a delivery week"
              message="Select a named delivery week to review its work."
            />
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
                        `purchase:${purchase.cycleId}:${purchase.locationId}:${purchase.item.skuId}`,
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
                        "POST",
                        { title: "Purchase recorded" },
                      );
                  if (saved) {
                    setConfirmedPurchaseKey(purchaseVersionKey(purchase.cycleId, purchase.item));
                    setPurchase(null);
                    setReload((value) => value + 1);
                  }
                })();
              }}
            >
              <p className="font-semibold">
                {purchase.item.productName} · {purchase.item.variantName}
              </p>
              <p>{purchase.item.locationName}</p>
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
