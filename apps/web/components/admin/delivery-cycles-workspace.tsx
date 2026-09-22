"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DatesSetInfo } from "@fullcalendar/react";
import { Plus } from "lucide-react";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import type {
  AdminCycleDestinations,
  AdminDeliveryCyclePage,
  AdminDeliveryCycleView,
  DeliveryCycleDraft,
  DeliveryCycleState,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  z,
  adminCycleDestinationsSchema,
  adminDeliveryCyclePageSchema,
  adminDeliveryCycleViewSchema,
  deliveryCycleDraftSchema,
} from "@freshmarkets/validation";
import { PageHeader } from "./admin-shell";
import { WorkspaceNavigation } from "./workspace-navigation";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetContent } from "../ui/sheet";
import { CycleCalendar } from "./delivery-cycles/cycle-calendar";
import { CycleDetailsPanel } from "./delivery-cycles/cycle-details-panel";
import { CycleEditor } from "./delivery-cycles/cycle-editor";
import {
  addBusinessDays,
  businessFieldsToInstant,
  suggestedCycleSchedule,
} from "./delivery-cycles/cycle-time";

const failure = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const listResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminDeliveryCyclePageSchema }),
]);
const destinationsResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminCycleDestinationsSchema }),
]);
const commandResult = z.union([
  failure,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminDeliveryCycleViewSchema }),
]);
type Command =
  | ({ action: "SAVE" } & DeliveryCycleDraft)
  | { action: "SCHEDULE" | "CANCEL"; cycleId: string; expectedVersion: number; reason: string };
type EditorMode = "new" | "edit" | "duplicate";
type Range = { rangeStart: string; rangeEnd: string };

const statuses: readonly DeliveryCycleState[] = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CUTOFF_REACHED",
  "PROCUREMENT",
  "RECEIVING",
  "PACKING",
  "DISPATCHING",
  "DELIVERING",
  "CLOSED",
  "CANCELED",
];

function blank(marketId: string): DeliveryCycleDraft {
  return {
    marketId,
    name: "",
    orderOpensAt: "",
    cutoffAt: "",
    procurementAt: "",
    preparationAt: "",
    pickupAt: "",
    windows: [{ name: "Scheduled delivery", startsAt: "", endsAt: "" }],
    participation: [],
    expectedVersion: 0,
    reason: "",
  };
}

function draftFromCycle(cycle: AdminDeliveryCycleView): DeliveryCycleDraft {
  return {
    cycleId: cycle.cycleId,
    marketId: cycle.marketId,
    name: cycle.name,
    orderOpensAt: cycle.orderOpensAt,
    cutoffAt: cycle.cutoffAt,
    procurementAt: cycle.procurementAt ?? "",
    preparationAt: cycle.preparationAt ?? "",
    pickupAt: cycle.pickupAt ?? "",
    windows: [
      cycle.windows[0]
        ? {
            name: cycle.windows[0].name,
            startsAt: cycle.windows[0].startsAt,
            endsAt: cycle.windows[0].endsAt,
          }
        : { name: "Scheduled delivery", startsAt: "", endsAt: "" },
    ],
    participation: cycle.participation.map(({ zoneId, locationId }) => ({ zoneId, locationId })),
    expectedVersion: cycle.version,
    reason: "",
  };
}

function duplicateFromCycle(cycle: AdminDeliveryCycleView): DeliveryCycleDraft {
  const { cycleId: _cycleId, ...copy } = draftFromCycle(cycle);
  return { ...copy, name: `${cycle.name} copy`, expectedVersion: 0 };
}

function blankForDeliveryDate(
  marketId: string,
  date: string,
  timezone: string,
): DeliveryCycleDraft {
  const value = new Date(`${date}T12:00:00`);
  return {
    ...blank(marketId),
    name: `${new Intl.DateTimeFormat("en-PH", { weekday: "long" }).format(value)} delivery · ${new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short" }).format(value)}`,
    ...suggestedCycleSchedule(date, timezone),
    windows: [
      {
        name: "Scheduled delivery",
        startsAt: businessFieldsToInstant({ date, time: "09:00" }, timezone),
        endsAt: businessFieldsToInstant({ date, time: "12:00" }, timezone),
      },
    ],
  };
}

function blankForPlanningRange(
  marketId: string,
  startDate: string,
  endDateExclusive: string,
  timezone: string,
): DeliveryCycleDraft {
  const deliveryDateValue = addBusinessDays(endDateExclusive, -1);
  if (deliveryDateValue <= startDate) return blankForDeliveryDate(marketId, startDate, timezone);
  const draft = blankForDeliveryDate(marketId, deliveryDateValue, timezone);
  return {
    ...draft,
    ...suggestedCycleSchedule(deliveryDateValue, timezone, startDate),
  };
}

function ResponsivePanel({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setDocked(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (!open) return null;
  if (docked)
    return (
      <aside
        aria-label="Cycle workspace panel"
        className="sticky top-4 h-[calc(100vh-10rem)] min-h-[34rem] max-h-[42rem] w-[20rem] shrink-0 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]"
      >
        {children}
      </aside>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:w-[30rem] [&>button]:hidden">
        {children}
      </SheetContent>
    </Sheet>
  );
}

export function DeliveryCyclesWorkspace({
  initial,
}: {
  initial: RpcResult<AdminDeliveryCyclePage>;
}) {
  const { state: adminState } = useAdminContext();
  const [page, setPage] = useState(initial.ok ? initial.value : null);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DeliveryCycleDraft | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("new");
  const [destinations, setDestinations] = useState<AdminCycleDestinations>({
    items: [],
    nextCursor: null,
  });
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [marketFilter, setMarketFilter] = useState<string>(
    initial.ok ? (initial.value.markets[0]?.marketId ?? "all") : "all",
  );
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<DeliveryCycleState | "all">("all");
  const [visibleRange, setVisibleRange] = useState<Range | null>(null);
  const [notice, setNotice] = useState(initial.ok ? "" : initial.error.message);
  const [loading, setLoading] = useState(false);
  const [rangeIncomplete, setRangeIncomplete] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const loadSequence = useRef(0);
  const destinationLoadSequence = useRef(0);
  const intent = useAdminCommandIntent();
  const marketId =
    draft?.marketId ?? (marketFilter === "all" ? page?.markets[0]?.marketId : marketFilter) ?? "";
  const timezone =
    page?.markets.find((market) => market.marketId === marketId)?.timezone ??
    page?.markets[0]?.timezone ??
    "Asia/Manila";
  const selectedCycle = page?.items.find((cycle) => cycle.cycleId === selectedCycleId) ?? null;

  const loadDestinations = useCallback(async () => {
    if (!marketId) return;
    const sequence = ++destinationLoadSequence.current;
    setDestinationsLoading(true);
    let cursor: string | null = null;
    let items: AdminCycleDestinations["items"] = [];
    try {
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const params = new URLSearchParams({ marketId });
        if (cursor) params.set("cursor", cursor);
        const result = destinationsResult.parse(
          await (await fetch(`/api/admin/delivery-cycles?${params}`)).json(),
        );
        if (!result.ok) throw new Error(result.error.message);
        items = [...items, ...result.value.items];
        cursor = result.value.nextCursor;
        if (!cursor) break;
      }
      if (cursor) throw new Error("The location list is larger than the supported planning limit.");
      if (sequence !== destinationLoadSequence.current) return;
      setDestinations({
        items: [
          ...new Map(items.map((item) => [`${item.zoneId}:${item.locationId}`, item])).values(),
        ],
        nextCursor: null,
      });
      setDestinationError(null);
    } catch {
      if (sequence !== destinationLoadSequence.current) return;
      setDestinations({ items, nextCursor: null });
      setDestinationError("Fulfillment locations could not be loaded. Retry the list.");
    } finally {
      if (sequence === destinationLoadSequence.current) setDestinationsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    setDestinations({ items: [], nextCursor: null });
    setDestinationError(null);
    void loadDestinations();
  }, [loadDestinations]);

  const loadRange = useCallback(
    async (range: Range) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      setRangeIncomplete(false);
      let cursor: string | null = null;
      let combined: AdminDeliveryCycleView[] = [];
      try {
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const params = new URLSearchParams(range);
          if (marketFilter !== "all") params.set("marketId", marketFilter);
          if (locationFilter !== "all") params.set("locationId", locationFilter);
          if (statusFilter !== "all") params.set("status", statusFilter);
          if (cursor) params.set("cursor", cursor);
          const result = listResult.parse(
            await (await fetch(`/api/admin/delivery-cycles?${params}`)).json(),
          );
          if (!result.ok) throw new Error(result.error.message);
          combined = [...combined, ...result.value.items];
          cursor = result.value.nextCursor;
          if (!cursor) {
            if (sequence !== loadSequence.current) return;
            setPage((current) => ({
              ...result.value,
              markets: result.value.markets.length
                ? result.value.markets
                : (current?.markets ?? []),
              items: [...new Map(combined.map((cycle) => [cycle.cycleId, cycle])).values()],
              nextCursor: null,
            }));
            setNotice("");
            return;
          }
        }
        throw new Error("Cycle range exceeded the supported page limit.");
      } catch (error) {
        if (sequence !== loadSequence.current) return;
        if (combined.length) {
          setPage((current) => (current ? { ...current, items: combined } : current));
          setRangeIncomplete(true);
        } else {
          setNotice(
            error instanceof Error ? error.message : "Cycles could not be loaded. Retry refresh.",
          );
        }
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [locationFilter, marketFilter, statusFilter],
  );

  useEffect(() => {
    if (visibleRange) void loadRange(visibleRange);
  }, [loadRange, visibleRange]);

  async function submit(command: Command) {
    if (intent.pending) return;
    const submitted = pending ?? command;
    setPending(submitted);
    try {
      const result = await intent.submit(async (key) =>
        commandResult.parse(
          await (
            await fetch("/api/admin/delivery-cycles", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(submitted),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (result.ok) {
        notifyCommandSuccess(
          result.value.status === "DRAFT"
            ? "Delivery cycle draft saved"
            : result.value.status === "CANCELED"
              ? "Delivery cycle deactivated"
              : "Delivery cycle activated",
        );
        setPage((current) =>
          current
            ? {
                ...current,
                items: [
                  result.value,
                  ...current.items.filter((cycle) => cycle.cycleId !== result.value.cycleId),
                ],
              }
            : current,
        );
        setDraft(null);
        setSelectedCycleId(result.value.cycleId);
        setNotice(
          result.value.status === "DRAFT"
            ? "Draft saved. Activate it when the plan is ready for customers."
            : result.value.status === "CANCELED"
              ? "Cycle deactivated. Unstarted checkout quotes are no longer usable."
              : "Cycle activated. Orders become eligible at the configured opening time.",
        );
      } else setNotice(result.error.message);
    } catch {
      setNotice("Response not confirmed. Retry the same cycle request to recover its result.");
    }
  }

  const openNew = (date?: string) => {
    setDraft(date ? blankForDeliveryDate(marketId, date, timezone) : blank(marketId));
    setEditorMode("new");
    setSelectedCycleId(null);
  };
  const onDatesSet = (info: DatesSetInfo) => {
    const next = { rangeStart: info.startStr, rangeEnd: info.endStr };
    setVisibleRange((current) =>
      current?.rangeStart === next.rangeStart && current.rangeEnd === next.rangeEnd
        ? current
        : next,
    );
  };
  const panelOpen = Boolean(draft || selectedCycle);
  const disabled = pending !== null || intent.pending;
  if (adminState.phase === "ready" && adminState.selectedScope?.kind !== "GLOBAL" && !pending)
    return <p>Select Global to administer Scheduled cycles.</p>;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Scheduled cycles"
        description="Plan ordering, fulfillment, and customer delivery."
        action={
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--fm-border)] px-3 py-1.5 text-xs font-medium text-[var(--fm-text-muted)]">
              {timezone}
            </span>
            {page?.canManage ? (
              <Button type="button" disabled={disabled} onClick={() => openNew()}>
                <Plus aria-hidden className="size-4" /> New cycle
              </Button>
            ) : null}
          </div>
        }
      />
      <WorkspaceNavigation parentCode="settings" label="Settings administration" />
      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-4 py-3 text-sm"
        >
          {notice}
        </p>
      ) : null}
      {pending && !panelOpen ? (
        <Button disabled={intent.pending} onClick={() => void submit(pending)}>
          Retry unconfirmed request
        </Button>
      ) : null}
      <div className="flex min-w-0 items-stretch gap-4">
        <div className="min-w-0 flex-1">
          <CycleCalendar
            cycles={page?.items ?? []}
            timezone={timezone}
            selectedCycleId={selectedCycleId}
            draft={draft}
            loading={loading}
            rangeIncomplete={rangeIncomplete}
            canCreate={Boolean(page?.canManage) && !disabled}
            filters={
              <>
                {page && page.markets.length > 1 ? (
                  <label className="block">
                    <span className="sr-only">Market</span>
                    <Select
                      value={marketFilter}
                      onValueChange={(value) => {
                        setMarketFilter(value);
                        setLocationFilter("all");
                      }}
                    >
                      <SelectTrigger className="min-w-28 bg-[var(--fm-admin-surface)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {page.markets.map((market) => (
                          <SelectItem key={market.marketId} value={market.marketId}>
                            {market.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ) : null}
                <label className="block">
                  <span className="sr-only">Location</span>
                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="min-w-28 bg-[var(--fm-admin-surface)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All locations</SelectItem>
                      {destinations.items.map((item) => (
                        <SelectItem key={item.locationId} value={item.locationId}>
                          {item.locationName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block">
                  <span className="sr-only">Status</span>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as DeliveryCycleState | "all")}
                  >
                    <SelectTrigger className="min-w-28 bg-[var(--fm-admin-surface)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {statuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status.toLowerCase().replaceAll("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </>
            }
            onRangeChange={onDatesSet}
            onSelectCycle={(cycleId) => {
              setDraft(null);
              setSelectedCycleId(cycleId);
            }}
            onEmptyDate={(date) => page?.canManage && openNew(date)}
            onDateRange={(startDate, endDateExclusive) => {
              if (!page?.canManage) return;
              setDraft(blankForPlanningRange(marketId, startDate, endDateExclusive, timezone));
              setEditorMode("new");
              setSelectedCycleId(null);
            }}
            onRefresh={() => visibleRange && void loadRange(visibleRange)}
          />
        </div>
        <ResponsivePanel
          open={panelOpen}
          onOpenChange={(open) => {
            if (!open) {
              setDraft(null);
              setSelectedCycleId(null);
            }
          }}
        >
          {draft ? (
            <CycleEditor
              draft={draft}
              mode={editorMode}
              markets={page?.markets ?? []}
              timezone={timezone}
              destinations={destinations}
              destinationsLoading={destinationsLoading}
              destinationError={destinationError}
              pending={disabled}
              submitting={intent.pending}
              retryAvailable={pending !== null}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={(value) => {
                const parsed = deliveryCycleDraftSchema.safeParse(value);
                if (parsed.success) void submit({ action: "SAVE", ...parsed.data });
                else
                  setNotice("Review the highlighted schedule, location, and planning note fields.");
              }}
              onRetry={() => pending && void submit(pending)}
              onLoadMoreDestinations={() => void loadDestinations()}
            />
          ) : selectedCycle ? (
            <CycleDetailsPanel
              cycle={selectedCycle}
              canManage={Boolean(page?.canManage)}
              pending={disabled}
              submitting={intent.pending}
              retryAvailable={pending !== null}
              onClose={() => setSelectedCycleId(null)}
              onEdit={() => {
                setDraft(draftFromCycle(selectedCycle));
                setEditorMode("edit");
              }}
              onDuplicate={() => {
                setDraft(duplicateFromCycle(selectedCycle));
                setEditorMode("duplicate");
                setSelectedCycleId(null);
              }}
              onCommand={(action, reason) =>
                void submit({
                  action,
                  cycleId: selectedCycle.cycleId,
                  expectedVersion: selectedCycle.version,
                  reason,
                })
              }
              onRetry={() => pending && void submit(pending)}
            />
          ) : null}
        </ResponsivePanel>
      </div>
    </div>
  );
}
