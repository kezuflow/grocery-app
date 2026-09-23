"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fulfillmentQueueFilters,
  type FulfillmentQueueFilter,
  type FulfillmentQueuePage,
  type RpcResult,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
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
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { OperationalOrderDetail } from "../../../components/admin/operational-order-detail";
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

export default function FulfillmentPage() {
  const { locationId, label } = useAdminLocation();
  const orderId = useSearchParams().get("orderId");
  const [page, setPage] = useState<FulfillmentQueuePage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(orderId);
  const [view, setView] = useState<FulfillmentQueueFilter>("ALL");
  const operationalRefresh = useAdminOperationalRefresh();
  const actionIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(`${locationId}:${orderId}:${view}`);
  const load = useCallback(
    async (cursor: string | null, background = false) => {
      if (!background) setState("loading");
      try {
        const params = new URLSearchParams({
          locationId: locationId ?? "",
          limit: "50",
          filter: view,
        });
        if (orderId) params.set("orderId", orderId);
        if (cursor) params.set("cursor", cursor);
        const payload = (await (
          await fetch(`/api/admin/fulfillment?${params}`)
        ).json()) as RpcResult<FulfillmentQueuePage>;
        if (!payload.ok) {
          setNotice(
            payload.error.code === "FORBIDDEN"
              ? "Fulfillment access is not permitted for this scope."
              : payload.error.message,
          );
          setState("error");
          return;
        }
        setPage(payload.value);
        if (!background) setNotice(null);
        setSelectedOrderId((current) =>
          current && payload.value.items.some((item) => item.orderId === current)
            ? current
            : (payload.value.items[0]?.orderId ?? null),
        );
        setState("ready");
      } catch {
        setNotice("Network error loading fulfillment.");
        setState("error");
      }
    },
    [locationId, orderId, view],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
  }, [load, locationId, pagination.cursor]);
  useEffect(() => {
    if (locationId && operationalRefresh.revision > 0) void load(pagination.cursor, true);
    // The shared owner drives narrow revalidation without clearing the current list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationalRefresh.revision]);
  const selected = page?.items.find((item) => item.orderId === selectedOrderId) ?? null;
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
        description="Accept paid orders, finish picking, start packing and finish packing. Instant cancellation closes at acceptance; Scheduled cancellation closes at packing or cutoff, whichever comes first."
      />
      {orderId ? (
        <Link href="/admin/fulfillment" className="text-sm underline">
          Show all fulfillment work
        </Link>
      ) : null}
      {!locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message="Choose a location scope in the Admin header to open the fulfillment queue."
        />
      ) : state === "loading" ? (
        <div role="status" aria-label="Loading fulfillment">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Fulfillment could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(pagination.cursor)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
          <ListPageSection
            title="Orders"
            description={`Current location: ${label}. Paid operational snapshots only; finance remains in Orders.`}
          >
            <div className="flex flex-wrap gap-2 border-b p-3" aria-label="Fulfillment views">
              {fulfillmentQueueFilters.map((candidate) => (
                <Button
                  key={candidate}
                  size="sm"
                  variant={view === candidate ? "default" : "outline"}
                  onClick={() => setView(candidate)}
                >
                  {candidate.replaceAll("_", " ")}
                </Button>
              ))}
              {operationalRefresh.refreshing ? (
                <span className="self-center text-xs text-[var(--fm-text-muted)]">Updating…</span>
              ) : null}
              {operationalRefresh.stale ? (
                <span role="status" className="self-center text-xs text-amber-700">
                  Updates delayed
                </span>
              ) : null}
            </div>
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No fulfillment tasks match this location.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Next action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.items.map((item) => (
                      <TableRow
                        key={item.orderId}
                        className="cursor-pointer"
                        aria-selected={selectedOrderId === item.orderId}
                        onClick={() => setSelectedOrderId(item.orderId)}
                      >
                        <TableCell className="font-medium">
                          {item.operational?.orderNumber ?? item.orderId}
                        </TableCell>
                        <TableCell>
                          {item.operational?.timing.windowName ??
                            item.operational?.timing.cycleName ??
                            "Instant"}
                        </TableCell>
                        <TableCell>{item.locationId}</TableCell>
                        <TableCell>
                          <StatusBadge>{item.status}</StatusBadge>
                        </TableCell>
                        <TableCell>
                          {item.status === "PACKING" &&
                          item.operational?.fulfillmentMode === "SCHEDULED" &&
                          !item.allowedActions.includes("MARK_PACKED")
                            ? "Record received goods"
                            : item.allowedActions[0]
                              ? actionLabels[item.allowedActions[0]]
                              : item.status === "PACKED"
                                ? item.operational?.fulfillmentMode === "INSTANT"
                                  ? item.operational.deliveryExecution?.status === "FAILED"
                                    ? "Resolve Lalamove booking failure"
                                    : "View Lalamove delivery"
                                  : "Choose dispatch"
                                : "No action"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <AdminCursorPagination
              pageNumber={pagination.pageNumber}
              nextCursor={page.nextCursor}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </ListPageSection>
          {selected ? (
            <OperationalOrderDetail
              item={selected}
              reason={reason}
              setReason={setReason}
              pending={actionIntent.pending}
              onAction={(action) => void act(selected.orderId, action, selected.version)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
