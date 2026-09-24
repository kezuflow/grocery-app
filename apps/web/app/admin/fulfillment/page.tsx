"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fulfillmentQueueFilters,
  type FulfillmentQueueFilter,
  type FulfillmentQueuePage,
  type FulfillmentQueueView,
  type RpcResult,
} from "@freshmarkets/contracts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../../../components/admin/admin-shell";
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import {
  AdminIndexViews,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import {
  OperationalOrderDetail,
  preparationStatus,
} from "../../../components/admin/operational-order-detail";
import { useAdminOperationalRefresh } from "../admin-operational-refresh-provider";
import { notifyCommandSuccess } from "../../../components/admin/admin-feedback";

const actionLabels: Record<string, string> = {
  START_PICKING: "Accept order & start picking",
  MARK_READY_TO_PACK: "Finish picking",
  START_PACKING: "Start packing",
  MARK_PACKED: "Finish packing",
  RECORD_SHORTAGE: "Report shortage",
  RESUME_PICKING: "Resume picking",
  RESUME_READY_TO_PACK: "Resume packing preparation",
  ESCALATE: "Escalate shortage",
};

const actionSuccessTitles: Record<string, string> = {
  START_PICKING: "Picking started",
  MARK_READY_TO_PACK: "Picking finished",
  START_PACKING: "Packing started",
  MARK_PACKED: "Packing finished",
  RECORD_SHORTAGE: "Shortage recorded",
  RESUME_PICKING: "Picking resumed",
  RESUME_READY_TO_PACK: "Packing preparation resumed",
  ESCALATE: "Shortage escalated",
};

const queueViewLabels: Record<FulfillmentQueueFilter, string> = {
  ALL: "All",
  NEW: "New",
  PREPARING: "Preparing",
  READY_FOR_DISPATCH: "Ready for dispatch",
  UPCOMING: "Upcoming Scheduled",
  HISTORY: "History",
};
const queueViews = fulfillmentQueueFilters.map((status) => ({
  status,
  label: queueViewLabels[status],
}));

function dateTime(value: string | null, timezone: string | null): string {
  if (!value) return "Timing pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Timing unavailable"
    : `${new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone ?? "UTC",
      }).format(date)} ${timezone ?? "UTC"}`;
}

function lineSummary(item: FulfillmentQueueView): string {
  const lines = item.operational?.lines ?? [];
  if (lines.length === 0) return "No item snapshot";
  const first = lines[0];
  return `${first.quantity} ${first.unit} ${first.productName}${lines.length > 1 ? ` · +${lines.length - 1} more` : ""}`;
}

function nextStep(item: FulfillmentQueueView): string {
  if (
    item.status === "PACKING" &&
    item.operational?.fulfillmentMode === "SCHEDULED" &&
    !item.allowedActions.includes("MARK_PACKED")
  )
    return "Record received goods";
  if (item.allowedActions[0]) return actionLabels[item.allowedActions[0]] ?? item.allowedActions[0];
  if (item.status !== "PACKED") return "No preparation action";
  if (item.operational?.fulfillmentMode === "SCHEDULED") return "Choose dispatch";
  return item.operational?.deliveryExecution?.status === "FAILED"
    ? "Resolve Lalamove booking failure"
    : "View Lalamove delivery";
}

export default function FulfillmentPage() {
  const { locationId, label } = useAdminLocation();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const cycleId = searchParams.get("cycleId");
  const [page, setPage] = useState<FulfillmentQueuePage | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(orderId);
  const [view, setView] = useState<FulfillmentQueueFilter>("ALL");
  const operationalRefresh = useAdminOperationalRefresh();
  const actionIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(`${locationId}:${orderId}:${cycleId}:${view}`);
  const requestSequence = useRef(0);
  const pageKeyRef = useRef<string | null>(null);
  const observedRefreshRevision = useRef(operationalRefresh.revision);
  const queryKey = `${locationId}:${orderId}:${cycleId}:${view}:${pagination.cursor}`;
  const load = useCallback(
    async (cursor: string | null, background = false) => {
      const sequence = ++requestSequence.current;
      const key = `${locationId}:${orderId}:${cycleId}:${view}:${cursor}`;
      if (!background) setState("loading");
      try {
        const params = new URLSearchParams({
          locationId: locationId ?? "",
          limit: "50",
          filter: view,
        });
        if (orderId) params.set("orderId", orderId);
        if (cycleId) params.set("cycleId", cycleId);
        if (cursor) params.set("cursor", cursor);
        const payload = (await (
          await fetch(`/api/admin/fulfillment?${params}`)
        ).json()) as RpcResult<FulfillmentQueuePage>;
        if (sequence !== requestSequence.current) return;
        if (!payload.ok) {
          setNotice(
            payload.error.code === "FORBIDDEN"
              ? "Fulfillment access is not permitted for this scope."
              : payload.error.message,
          );
          setRequestId(payload.error.requestId);
          if (background && pageKeyRef.current === key) return;
          setState("error");
          return;
        }
        setPage(payload.value);
        pageKeyRef.current = key;
        setPageKey(key);
        setNotice(null);
        setRequestId(null);
        setSelectedOrderId((current) =>
          current && payload.value.items.some((item) => item.orderId === current)
            ? current
            : (payload.value.items[0]?.orderId ?? null),
        );
        setState("ready");
      } catch {
        if (sequence !== requestSequence.current) return;
        setNotice("Network error loading fulfillment.");
        setRequestId(null);
        if (background && pageKeyRef.current === key) return;
        setState("error");
      }
    },
    [locationId, orderId, cycleId, view],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
    return () => {
      requestSequence.current += 1;
    };
  }, [load, locationId, pagination.cursor]);
  useEffect(() => {
    if (observedRefreshRevision.current === operationalRefresh.revision) return;
    observedRefreshRevision.current = operationalRefresh.revision;
    if (locationId) void load(pagination.cursor, true);
  }, [operationalRefresh.revision, load, locationId, pagination.cursor]);
  const currentPage = pageKey === queryKey ? page : null;
  const selected = currentPage?.items.find((item) => item.orderId === selectedOrderId) ?? null;
  async function act(orderId: string, action: string, expectedVersion: number) {
    if (!locationId || actionIntent.pending) return;
    let payload: RpcResult<unknown>;
    try {
      payload = await actionIntent.submit(async (idempotencyKey) => {
        const response = await fetch("/api/admin/fulfillment", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            locationId,
            orderId,
            action,
            expectedVersion,
            reason: reason.trim() || undefined,
          }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry the same action to safely reuse its request key.");
      return;
    }
    setNotice(payload.ok ? `${actionLabels[action] ?? action} completed.` : payload.error.message);
    if (
      payload.ok ||
      (!payload.ok && (payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT"))
    )
      void load(pagination.cursor);
    if (payload.ok) {
      notifyCommandSuccess(actionSuccessTitles[action] ?? "Fulfillment updated");
      operationalRefresh.refresh();
    }
  }
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Fulfillment"
        description={`Paid preparation work for ${locationId ? label : "a selected location"}. Core controls each available action and packing prerequisite.`}
      />
      {orderId || cycleId ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--fm-text-muted)]">
            {orderId ? `Order ${orderId}` : null}
            {orderId && cycleId ? " · " : null}
            {cycleId ? `Delivery week ${cycleId}` : null}
          </span>
          <Link href="/admin/fulfillment" className="font-medium underline">
            Show all fulfillment work
          </Link>
        </div>
      ) : null}
      {locationId ? (
        <div className="overflow-hidden rounded-[var(--fm-radius-panel)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)]">
          <AdminIndexViews<FulfillmentQueueFilter>
            label="Fulfillment views"
            views={queueViews}
            value={view}
            onChange={setView}
          />
        </div>
      ) : null}
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location scope in the Admin header to open the fulfillment queue."
        />
      ) : state === "loading" || (!currentPage && state !== "error") ? (
        <AdminPageState state="loading" title="Loading fulfillment" />
      ) : null}
      {locationId && state === "error" ? (
        <AdminPageState
          state="error"
          title="Fulfillment could not be loaded"
          message={notice ?? undefined}
          requestId={requestId ?? undefined}
          onRetry={() => void load(pagination.cursor)}
        />
      ) : null}
      {locationId && state === "ready" && currentPage ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)]">
          <ListPageSection
            title="Preparation queue"
            description={`${label} · ${currentPage.items.length} ${currentPage.items.length === 1 ? "order" : "orders"} on this page`}
          >
            <div className="flex min-h-8 flex-wrap items-center gap-3 border-b px-4 py-2 text-xs text-[var(--fm-text-muted)]">
              <span>Showing Core-filtered paid orders for the selected location</span>
              {operationalRefresh.refreshing ? <span role="status">Updating…</span> : null}
              {operationalRefresh.stale ? (
                <span role="status" className="text-amber-700">
                  Updates delayed
                </span>
              ) : null}
            </div>
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {currentPage.items.length === 0 ? (
              <div className="p-4">
                <AdminPageState
                  state="filtered-empty"
                  title="No orders in this view"
                  message={`The ${queueViews.find((candidate) => candidate.status === view)?.label ?? view} view has no paid preparation work for ${label}.`}
                />
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="xl:hidden 2xl:table-cell">Timing</TableHead>
                      <TableHead>Preparation</TableHead>
                      <TableHead>Next action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentPage.items.map((item) => (
                      <TableRow
                        key={item.orderId}
                        className={
                          selectedOrderId === item.orderId
                            ? "bg-[var(--fm-admin-canvas)]"
                            : undefined
                        }
                        aria-selected={selectedOrderId === item.orderId}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("button, a")) return;
                          setSelectedOrderId(item.orderId);
                        }}
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          <button
                            type="button"
                            className="text-left font-semibold underline-offset-2 hover:underline focus-visible:underline"
                            aria-controls="fulfillment-work-area"
                            aria-pressed={selectedOrderId === item.orderId}
                            onClick={() => setSelectedOrderId(item.orderId)}
                          >
                            {item.operational?.orderNumber ?? item.orderId}
                          </button>
                          <span className="block text-xs font-normal text-[var(--fm-text-muted)]">
                            {item.operational?.fulfillmentMode === "SCHEDULED"
                              ? "Scheduled"
                              : "Instant"}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-32">
                          {item.operational?.recipient.name ?? "Recipient unavailable"}
                        </TableCell>
                        <TableCell className="min-w-40 text-xs">{lineSummary(item)}</TableCell>
                        <TableCell className="min-w-36 text-xs xl:hidden 2xl:table-cell">
                          <span className="block font-medium">
                            {item.operational?.timing.windowName ??
                              item.operational?.timing.cycleName ??
                              "Paid order"}
                          </span>
                          <span className="text-[var(--fm-text-muted)]">
                            {dateTime(
                              item.operational?.timing.startsAt ??
                                item.operational?.timing.pickupAt ??
                                item.operational?.committedAt ??
                                null,
                              item.operational?.timing.timezone ?? null,
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge>{preparationStatus(item.status)}</StatusBadge>
                        </TableCell>
                        <TableCell className="min-w-40 text-xs">{nextStep(item)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={currentPage.nextCursor}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
          {selected ? (
            <div id="fulfillment-work-area" className="min-w-0">
              <OperationalOrderDetail
                item={selected}
                reason={reason}
                setReason={setReason}
                pending={actionIntent.pending}
                onAction={(action) => void act(selected.orderId, action, selected.version)}
              />
            </div>
          ) : (
            <div id="fulfillment-work-area">
              <AdminPageState
                state="empty"
                title="Select an order"
                message="Choose an order from the current queue view to inspect its paid items and available actions."
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
