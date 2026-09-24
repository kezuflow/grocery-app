"use client";

import type {
  DeliveryOperationsSummary,
  ExternalDeliveryDispatchView,
  RpcResult,
} from "@freshmarkets/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../admin-shell";
import { useAdminLocation } from "../use-admin-location";
import { DispatchActions } from "./dispatch-actions";
import { DeliveryPromiseForm } from "./delivery-promise-form";
import { useAdminOperationalRefresh } from "../../../app/admin/admin-operational-refresh-provider";
import { notifyCommandSuccess } from "../admin-feedback";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../admin-controls";
import { useAdminContext, useAdminScopeGuard } from "../../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "../use-admin-route-guard";

type DeliveryDispatch = NonNullable<DeliveryOperationsSummary["items"][number]["externalDispatch"]>;

export function externalStatusLabel(
  dispatch: NonNullable<DeliveryOperationsSummary["items"][number]["externalDispatch"]>,
) {
  if (dispatch.status === "OUTCOME_UNKNOWN" || dispatch.status === "RECONCILIATION_REQUIRED")
    return "Awaiting provider confirmation";
  if (dispatch.status === "PENDING" || dispatch.status === "CREATING")
    return "Booking in progress…";
  if (dispatch.status === "RETRY_REQUIRED") return "Booking retry required";
  if (dispatch.status === "FAILED")
    return dispatch.providerDeliveryId ? "Delivery failed" : "Booking failed";
  if (dispatch.status === "CANCELED")
    return dispatch.providerDeliveryId ? "Delivery canceled" : "Booking canceled";
  switch (dispatch.providerStatus) {
    case "ALLOCATING":
      return "Finding rider";
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
      return "Rider assigned";
    case "IN_DELIVERY":
      return "Out for delivery";
    case "COMPLETED":
      return "Delivered";
    default:
      return dispatch.status;
  }
}

export function deliveryJobStatusLabel(status: string) {
  switch (status) {
    case "UNASSIGNED":
      return "Awaiting assignment";
    case "ASSIGNED":
      return "Assigned";
    case "EN_ROUTE":
      return "Out for delivery";
    case "FAILED":
      return "Delivery failed";
    case "RETRY_SCHEDULED":
      return "Retry scheduled";
    case "DELIVERED":
      return "Delivered";
    default:
      return status.toLowerCase().replaceAll("_", " ");
  }
}

export function ExternalDeliveryQueue() {
  const admin = useAdminContext();
  const canManage =
    admin.state.phase === "ready" && admin.state.context.capabilities.includes("delivery.manage");
  const { locationId, label } = useAdminLocation();
  const orderId = useSearchParams().get("orderId");
  const pagination = useAdminPagination(`${locationId}:${orderId}`);
  const readKey = JSON.stringify([locationId, orderId, pagination.cursor]);
  const currentReadKey = useRef(readKey);
  currentReadKey.current = readKey;
  const readController = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; value: DeliveryOperationsSummary } | null>(
    null,
  );
  const summary = loaded?.key === readKey ? loaded.value : null;
  const [providerReferences, setProviderReferences] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const loading = loadingKey === readKey;
  const [readError, setReadError] = useState<{ key: string; message: string } | null>(null);
  const [commandNotice, setCommandNotice] = useState<{ key: string; message: string } | null>(null);
  const message = [readError, commandNotice]
    .filter((entry) => entry?.key === readKey)
    .map((entry) => entry!.message)
    .join(" ");
  const operationalRefresh = useAdminOperationalRefresh();
  const [interactionStates, setInteractionStates] = useState<
    Record<string, { dirty: boolean; locked: boolean }>
  >({});
  const setInteraction = useCallback((id: string, dirty: boolean, locked: boolean) => {
    setInteractionStates((current) => {
      if (!dirty && !locked && !current[id]) return current;
      if (current[id]?.dirty === dirty && current[id]?.locked === locked) return current;
      const next = { ...current };
      if (dirty || locked) next[id] = { dirty, locked };
      else delete next[id];
      return next;
    });
  }, []);
  const providerIntent = useRef<{
    dispatchId: string;
    operation: "refresh" | "cancel";
    key: string;
    body: string;
  } | null>(null);
  const [providerLocked, setProviderLocked] = useState(false);
  const [providerPending, setProviderPending] = useState(false);
  const providerPendingRef = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<{
    dispatch: DeliveryDispatch;
    orderId: string;
    readKey: string;
  } | null>(null);
  const [discardPageDraft, setDiscardPageDraft] = useState(false);
  const pendingPageMove = useRef<(() => void) | null>(null);
  const pendingPageReadKey = useRef<string | null>(null);
  const restoreDialogFocus = useRef<HTMLElement | null>(null);
  const dirty = Object.values(interactionStates).some((state) => state.dirty);
  const locked =
    providerLocked ||
    cancelTarget !== null ||
    discardPageDraft ||
    Object.values(interactionStates).some((state) => state.locked);
  const blockedRef = useRef(false);
  blockedRef.current = dirty || locked;
  const refreshDeferred = useRef(false);
  useAdminScopeGuard(dirty, locked);
  useAdminRouteGuard(dirty, locked);

  const load = useCallback(
    async (background = false) => {
      if (!locationId || readKey !== currentReadKey.current) return;
      if (blockedRef.current) {
        refreshDeferred.current = true;
        return;
      }
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      if (!background) setLoadingKey(readKey);
      const params = new URLSearchParams({ locationId, limit: "100" });
      if (orderId) params.set("orderId", orderId);
      if (pagination.cursor) params.set("cursor", pagination.cursor);
      try {
        const result = (await (
          await fetch(`/api/admin/delivery?${params}`, {
            signal: controller.signal,
            cache: "no-store",
          })
        ).json()) as RpcResult<DeliveryOperationsSummary>;
        if (controller.signal.aborted || readKey !== currentReadKey.current) return;
        if (blockedRef.current) {
          refreshDeferred.current = true;
          return;
        }
        if (!result.ok) throw new Error(result.error.message);
        if (result.value.locationId !== locationId)
          throw new Error("Delivery scope changed. Refresh the queue.");
        setLoaded({ key: readKey, value: result.value });
        setReadError(null);
      } catch (error: unknown) {
        if (!controller.signal.aborted && readKey === currentReadKey.current && !blockedRef.current)
          setReadError({
            key: readKey,
            message: error instanceof Error ? error.message : "Delivery work could not be loaded.",
          });
      } finally {
        if (readKey === currentReadKey.current && !controller.signal.aborted) setLoadingKey(null);
      }
    },
    [locationId, orderId, pagination.cursor, readKey],
  );

  useEffect(() => {
    void load();
    return () => readController.current?.abort();
  }, [load]);
  useEffect(() => {
    if (locationId && operationalRefresh.revision > 0) void load(true);
    // The location refresh provider is the sole polling owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationalRefresh.revision]);
  useEffect(() => {
    if (!dirty && !locked && refreshDeferred.current) {
      refreshDeferred.current = false;
      void load(true);
    }
  }, [dirty, locked, load]);

  function changePage(move: () => void) {
    if (locked) return;
    if (dirty) {
      pendingPageMove.current = move;
      pendingPageReadKey.current = readKey;
      restoreDialogFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDiscardPageDraft(true);
      return;
    }
    move();
  }

  async function mutate(dispatch: DeliveryDispatch, operation: "refresh" | "cancel") {
    if (!locationId || !canManage || providerPendingRef.current || dispatch.provider !== "lalamove")
      return;
    const previous = providerIntent.current;
    if (
      previous &&
      (previous.dispatchId !== dispatch.dispatchId || previous.operation !== operation)
    )
      return;
    const request = previous ?? {
      dispatchId: dispatch.dispatchId,
      operation,
      key: crypto.randomUUID(),
      body: JSON.stringify({
        locationId,
        expectedVersion: dispatch.version,
        ...(!dispatch.providerDeliveryId && operation === "refresh"
          ? { providerDeliveryId: providerReferences[dispatch.dispatchId]?.trim() }
          : {}),
      }),
    };
    providerIntent.current = request;
    providerPendingRef.current = true;
    setProviderLocked(true);
    setProviderPending(true);
    try {
      const result = (await (
        await fetch(
          `/api/admin/external-deliveries/${encodeURIComponent(dispatch.dispatchId)}/${operation}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": request.key },
            body: request.body,
          },
        )
      ).json()) as RpcResult<ExternalDeliveryDispatchView>;
      providerIntent.current = null;
      setProviderLocked(false);
      setCommandNotice({
        key: readKey,
        message: result.ok ? `Provider delivery ${operation} completed.` : result.error.message,
      });
      if (
        result.ok &&
        operation === "cancel" &&
        !["OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(result.value.status)
      ) {
        notifyCommandSuccess("Lalamove cancellation requested");
      }
      refreshDeferred.current = true;
    } catch {
      setCommandNotice({
        key: readKey,
        message: `Provider delivery ${operation} outcome is unknown. Retry the saved request.`,
      });
    } finally {
      providerPendingRef.current = false;
      setProviderPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery"
        description={`Track courier and manual deliveries for ${label}.`}
      />
      {orderId ? (
        <Link href="/admin/delivery" className="text-sm underline">
          Show all delivery work
        </Link>
      ) : null}
      {message ? (
        <Alert variant="warning">
          <AlertTitle>Delivery update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {!locationId ? <p>Select a permitted location scope to view delivery work.</p> : null}
      {loading && !summary ? <Skeleton className="h-32 w-full" /> : null}
      {readError?.key === readKey ? (
        <Button variant="outline" onClick={() => void load()}>
          Refresh delivery queue
        </Button>
      ) : null}
      {summary ? (
        <ListPageSection
          title="Delivery queue"
          description="Track each order and its current delivery progress."
        >
          {summary.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No open courier work.</p>
          ) : (
            <div>
              <Table className="block lg:table" aria-label="Delivery queue">
                <TableHeader className="hidden lg:table-header-group">
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>FreshMarkets status</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="block lg:table-row-group">
                  {summary.items.map((item) => (
                    <TableRow
                      key={item.jobId}
                      className="grid grid-cols-2 gap-3 border-b border-[var(--fm-border)] p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:align-top [&>td]:p-0 lg:[&>td]:px-4 lg:[&>td]:py-3"
                    >
                      <TableCell className="col-span-2 whitespace-normal">
                        <Link
                          className="font-medium underline underline-offset-2"
                          href={`/admin/orders/${encodeURIComponent(item.orderId)}`}
                        >
                          Order {item.orderId.slice(0, 8)}
                        </Link>
                        <span className="block break-all font-mono text-xs text-[var(--fm-text-muted)]">
                          {item.orderId}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="mb-1 block text-[var(--fm-text-muted)] lg:hidden">
                          Mode
                        </span>
                        {item.fulfillmentMode === "INSTANT" ? "Instant" : "Scheduled"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="mb-1 block text-[var(--fm-text-muted)] lg:hidden">
                          FreshMarkets status
                        </span>
                        <StatusBadge>{deliveryJobStatusLabel(item.status)}</StatusBadge>
                        {item.deliveredAtIso ? (
                          <span className="mt-1 block text-xs text-[var(--fm-text-muted)]">
                            Delivered: {new Date(item.deliveredAtIso).toLocaleString("en-PH")}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="col-span-2 whitespace-normal text-sm lg:col-span-1">
                        <span className="mb-1 block text-[var(--fm-text-muted)] lg:hidden">
                          Delivery progress
                        </span>
                        {item.externalDispatch ? (
                          <div className="space-y-1 text-xs">
                            <p>
                              {item.externalDispatch.provider === "lalamove"
                                ? "Lalamove"
                                : "GrabExpress"}{" "}
                              · {externalStatusLabel(item.externalDispatch)}
                            </p>
                            {item.externalDispatch.quoteAmountMinor != null &&
                            item.externalDispatch.quoteCurrency ? (
                              <p>
                                Provider quote: {item.externalDispatch.quoteCurrency}{" "}
                                {(item.externalDispatch.quoteAmountMinor / 100).toFixed(2)}
                              </p>
                            ) : null}
                            {item.externalDispatch.actualCostMinor != null &&
                            item.externalDispatch.costCurrency ? (
                              <p>
                                Courier cost: {item.externalDispatch.costCurrency}{" "}
                                {(item.externalDispatch.actualCostMinor / 100).toFixed(2)}
                              </p>
                            ) : null}
                            {item.externalDispatch.trackingUrl ? (
                              <a
                                className="underline"
                                href={item.externalDispatch.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open provider tracking
                              </a>
                            ) : null}
                          </div>
                        ) : item.manualDelivery ? (
                          "Manual delivery"
                        ) : item.fulfillmentMode === "INSTANT" ? (
                          "Automatic Lalamove booking pending"
                        ) : (
                          "Not booked"
                        )}
                      </TableCell>
                      <TableCell className="col-span-2 whitespace-normal lg:col-span-1">
                        <span className="mb-2 block text-sm text-[var(--fm-text-muted)] lg:hidden">
                          Next action
                        </span>
                        {item.externalDispatch?.provider === "lalamove" && canManage ? (
                          <div className="flex flex-wrap gap-2">
                            {!item.externalDispatch.providerDeliveryId &&
                            ["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(
                              item.externalDispatch.status,
                            ) ? (
                              <label className="w-full text-xs">
                                Lalamove order number for recovery
                                <Input
                                  value={providerReferences[item.externalDispatch.dispatchId] ?? ""}
                                  onChange={(event) =>
                                    setProviderReferences((values) => ({
                                      ...values,
                                      [item.externalDispatch!.dispatchId]: event.target.value,
                                    }))
                                  }
                                  maxLength={200}
                                  disabled={providerLocked}
                                  placeholder="Order number from Lalamove"
                                />
                              </label>
                            ) : null}
                            {item.externalDispatch.providerDeliveryId ||
                            ["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(
                              item.externalDispatch.status,
                            ) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  providerPending ||
                                  (providerLocked &&
                                    (providerIntent.current?.dispatchId !==
                                      item.externalDispatch.dispatchId ||
                                      providerIntent.current?.operation !== "refresh"))
                                }
                                onClick={() => void mutate(item.externalDispatch!, "refresh")}
                              >
                                {providerLocked &&
                                providerIntent.current?.dispatchId ===
                                  item.externalDispatch.dispatchId &&
                                providerIntent.current?.operation === "refresh"
                                  ? "Retry saved refresh"
                                  : "Refresh provider"}
                              </Button>
                            ) : null}
                            {item.externalDispatch.status === "ACTIVE" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  providerPending ||
                                  (providerLocked &&
                                    (providerIntent.current?.dispatchId !==
                                      item.externalDispatch.dispatchId ||
                                      providerIntent.current?.operation !== "cancel"))
                                }
                                onClick={(event) => {
                                  const dispatch = item.externalDispatch!;
                                  if (
                                    providerIntent.current?.dispatchId === dispatch.dispatchId &&
                                    providerIntent.current.operation === "cancel"
                                  ) {
                                    void mutate(dispatch, "cancel");
                                    return;
                                  }
                                  restoreDialogFocus.current = event.currentTarget;
                                  setCancelTarget({ dispatch, orderId: item.orderId, readKey });
                                }}
                              >
                                {providerLocked &&
                                providerIntent.current?.dispatchId ===
                                  item.externalDispatch.dispatchId &&
                                providerIntent.current?.operation === "cancel"
                                  ? "Retry saved cancellation"
                                  : "Cancel"}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                        <DeliveryPromiseForm
                          item={item}
                          onChanged={() => void load()}
                          onInteractionState={(draft, command) =>
                            setInteraction(`${item.jobId}:promise`, draft, command)
                          }
                        />
                        <DispatchActions
                          item={item}
                          onBooked={(notice) => {
                            setCommandNotice({ key: readKey, message: notice });
                            void load();
                          }}
                          onChanged={() => void load()}
                          onInteractionState={(kind, draft, command) =>
                            setInteraction(`${item.jobId}:${kind}`, draft, command)
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={summary.nextCursor}
            pending={loading || locked}
            onPrevious={() => changePage(pagination.previous)}
            onNext={() => {
              if (summary.nextCursor) changePage(() => pagination.next(summary.nextCursor!));
            }}
          />
        </ListPageSection>
      ) : null}
      <AdminConfirmationDialog
        open={cancelTarget !== null}
        title="Cancel Lalamove delivery?"
        resource={cancelTarget ? `Order ${cancelTarget.orderId}` : "Delivery"}
        scope={label}
        consequence="Request cancellation of this active courier delivery. Wait for provider confirmation before assigning a replacement."
        reasonRequired={false}
        confirmLabel="Request cancellation"
        cancelLabel="Keep delivery"
        restoreFocusRef={restoreDialogFocus}
        pending={providerPending}
        onCancel={() => {
          if (!providerPending) setCancelTarget(null);
        }}
        onConfirm={() => {
          const target = cancelTarget;
          if (!target) return;
          if (target.readKey !== currentReadKey.current) {
            setCancelTarget(null);
            return;
          }
          void mutate(target.dispatch, "cancel").finally(() => setCancelTarget(null));
        }}
      />
      <AdminConfirmationDialog
        open={discardPageDraft}
        title="Discard delivery draft?"
        resource="Delivery queue draft"
        scope={label}
        consequence="Unsaved delivery form entries on this page will be lost when you change pages."
        reasonRequired={false}
        destructive={false}
        confirmLabel="Discard and change page"
        cancelLabel="Keep draft"
        restoreFocusRef={restoreDialogFocus}
        onCancel={() => {
          pendingPageMove.current = null;
          pendingPageReadKey.current = null;
          setDiscardPageDraft(false);
        }}
        onConfirm={() => {
          const move = pendingPageMove.current;
          const sameRead = pendingPageReadKey.current === currentReadKey.current;
          pendingPageMove.current = null;
          pendingPageReadKey.current = null;
          if (sameRead && move) {
            const heading = document.getElementById("admin-page-title");
            if (heading instanceof HTMLElement) {
              heading.tabIndex = -1;
              restoreDialogFocus.current = heading;
            }
          }
          setDiscardPageDraft(false);
          if (sameRead) move?.();
        }}
      />
    </div>
  );
}
