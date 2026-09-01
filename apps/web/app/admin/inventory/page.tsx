"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminInventoryLedgerPage,
  AdminInventoryPage,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection } from "../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../components/admin/admin-command-state";
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; page: AdminInventoryPage };

type LedgerLoadState =
  | { phase: "idle" }
  | { phase: "loading"; key: string }
  | { phase: "error"; key: string; message: string; requestId: string | null }
  | { phase: "ready"; key: string; page: AdminInventoryLedgerPage };

type StockMovement = "ADD" | "REMOVE";

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default function InventoryPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const loadRequest = useRef(0);
  const ledgerRequest = useRef(0);
  const { locationId, label: locationLabel } = useAdminLocation();
  const [ledgerFor, setLedgerFor] = useState<{
    poolId: string;
    name: string;
    baseUnitSymbol: string;
  } | null>(null);
  const [ledgerState, setLedgerState] = useState<LedgerLoadState>({ phase: "idle" });
  const [ledgerReloadVersion, setLedgerReloadVersion] = useState(0);
  const [adjustQuantity, setAdjustQuantity] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    poolId: string;
    productName: string;
    baseUnitSymbol: string;
    version: number;
    movement: StockMovement;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const adjustmentIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(locationId);
  const ledgerPagination = useAdminPagination(
    `${locationId ?? "no-location"}:${ledgerFor?.poolId ?? "no-pool"}`,
  );

  const load = useCallback((location: string, cursor: string | null) => {
    const requestNumber = loadRequest.current + 1;
    loadRequest.current = requestNumber;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/inventory?locationId=${encodeURIComponent(location)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        const payload = (await response.json()) as RpcResult<AdminInventoryPage>;
        if (loadRequest.current !== requestNumber) return;
        if (!payload.ok) {
          setState({
            phase: "error",
            message:
              payload.error.code === "FORBIDDEN"
                ? "Inventory reads require the inventory.read capability and scope over this location."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setState({ phase: "ready", page: payload.value });
      } catch {
        if (loadRequest.current !== requestNumber) return;
        setState({ phase: "error", message: "Network error loading inventory.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => {
    if (locationId) load(locationId, pagination.cursor);
  }, [load, locationId, pagination.cursor]);

  function loadLedger(poolId: string, name: string, baseUnitSymbol: string) {
    setLedgerFor({ poolId, name, baseUnitSymbol });
    setLedgerState({ phase: "idle" });
    ledgerPagination.reset();
  }

  useEffect(() => {
    if (!ledgerFor || !locationId) return;
    const key = `${locationId}:${ledgerFor.poolId}:${ledgerPagination.cursor ?? ""}`;
    const requestNumber = ledgerRequest.current + 1;
    ledgerRequest.current = requestNumber;
    setLedgerState({ phase: "loading", key });
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/inventory/${encodeURIComponent(ledgerFor.poolId)}/ledger?locationId=${encodeURIComponent(locationId)}&limit=20${ledgerPagination.cursor ? `&cursor=${encodeURIComponent(ledgerPagination.cursor)}` : ""}`,
        );
        const payload = (await response.json()) as RpcResult<AdminInventoryLedgerPage>;
        if (ledgerRequest.current !== requestNumber) return;
        if (!payload.ok) {
          setLedgerState({
            phase: "error",
            key,
            message: payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        setLedgerState({ phase: "ready", key, page: payload.value });
      } catch {
        if (ledgerRequest.current === requestNumber) {
          setLedgerState({
            phase: "error",
            key,
            message: "Network error loading the inventory ledger.",
            requestId: null,
          });
        }
      }
    })();
  }, [ledgerFor, ledgerPagination.cursor, ledgerReloadVersion, locationId]);

  const ledgerKey =
    ledgerFor && locationId
      ? `${locationId}:${ledgerFor.poolId}:${ledgerPagination.cursor ?? ""}`
      : null;
  const visibleLedgerState: LedgerLoadState =
    ledgerKey && "key" in ledgerState && ledgerState.key === ledgerKey
      ? ledgerState
      : ledgerKey
        ? { phase: "loading", key: ledgerKey }
        : { phase: "idle" };

  async function adjust(
    poolId: string,
    expectedVersion: number,
    movement: StockMovement,
    reason: string,
  ) {
    if (!locationId) {
      setNotice("Select an explicit location scope before adjusting inventory.");
      return;
    }
    const quantity = Number(adjustQuantity[poolId]);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setNotice("Enter a whole-number quantity greater than zero.");
      return;
    }
    const delta = movement === "ADD" ? quantity : -quantity;
    let payload: RpcResult<unknown>;
    try {
      payload = await adjustmentIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/inventory/${encodeURIComponent(poolId)}/adjustments`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({
              locationId,
              inventoryPoolId: poolId,
              operation: movement,
              quantityBase: Math.abs(delta),
              reason,
              expectedVersion,
            }),
          },
        );
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry confirmation to safely reuse the adjustment request.");
      return;
    }
    if (payload.ok || payload.error?.code === "STALE_VERSION") {
      setNotice(
        payload.ok
          ? movement === "ADD"
            ? "Stock added. The dated activity entry is shown below."
            : "Stock removed. The dated activity entry is shown below."
          : (payload.error?.message ?? "Version conflict; refresh."),
      );
      if (payload.ok) {
        if (confirming?.poolId === poolId) {
          setLedgerFor({
            poolId,
            name: confirming.productName,
            baseUnitSymbol: confirming.baseUnitSymbol,
          });
        }
        setAdjustQuantity({});
        setConfirming(null);
        setLedgerReloadVersion((current) => current + 1);
      }
      load(locationId, pagination.cursor);
    } else {
      setNotice(payload.error?.message ?? "The adjustment failed.");
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Inventory"
        description="Add or remove stock for the selected location. Every change records its date, reason, and staff actor."
      />

      {!locationId ? (
        <Alert>
          <AlertTitle>Location scope required</AlertTitle>
          <AlertDescription>
            Choose a location in the Admin header to inspect and update inventory.
          </AlertDescription>
        </Alert>
      ) : null}

      {locationId && state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading inventory">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {locationId && state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Inventory could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {locationId && state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Stock levels"
            description={`${locationLabel}. Enter a positive quantity, then choose Add stock or Remove stock.`}
          >
            {state.page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No inventory records for this location.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>On hand</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Update stock</TableHead>
                      <TableHead>Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.page.items.map((item) => (
                      <TableRow key={item.inventoryPoolId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-xs">
                          {item.onHandBase} {item.baseUnitSymbol}
                          <span className="block text-[var(--fm-text-muted)]">
                            {item.reservedBase} reserved
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {item.onHandBase - item.reservedBase} {item.baseUnitSymbol}
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Stock quantity for ${item.productName}`}
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            placeholder="0"
                            value={adjustQuantity[item.inventoryPoolId] ?? ""}
                            onChange={(event) =>
                              setAdjustQuantity({
                                ...adjustQuantity,
                                [item.inventoryPoolId]: event.target.value,
                              })
                            }
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              disabled={adjustmentIntent.pending}
                              onClick={() => {
                                const quantity = Number(adjustQuantity[item.inventoryPoolId]);
                                if (!Number.isInteger(quantity) || quantity <= 0) {
                                  setNotice("Enter a whole-number quantity greater than zero.");
                                  return;
                                }
                                setConfirming({
                                  poolId: item.inventoryPoolId,
                                  productName: item.productName,
                                  baseUnitSymbol: item.baseUnitSymbol,
                                  version: item.version,
                                  movement: "ADD",
                                });
                              }}
                            >
                              Add stock
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={adjustmentIntent.pending}
                              onClick={() => {
                                const quantity = Number(adjustQuantity[item.inventoryPoolId]);
                                if (!Number.isInteger(quantity) || quantity <= 0) {
                                  setNotice("Enter a whole-number quantity greater than zero.");
                                  return;
                                }
                                setConfirming({
                                  poolId: item.inventoryPoolId,
                                  productName: item.productName,
                                  baseUnitSymbol: item.baseUnitSymbol,
                                  version: item.version,
                                  movement: "REMOVE",
                                });
                              }}
                            >
                              Remove stock
                            </Button>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              loadLedger(
                                item.inventoryPoolId,
                                item.productName,
                                item.baseUnitSymbol,
                              )
                            }
                          >
                            View activity
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="px-4 pb-3 text-xs text-[var(--fm-text-muted)]">
                  The date and time are recorded automatically. Removing stock cannot reduce
                  available inventory below zero.
                </p>
                <AdminCursorPagination
                  pageNumber={pagination.pageNumber}
                  nextCursor={state.page.nextCursor}
                  onPrevious={pagination.previous}
                  onNext={pagination.next}
                />
              </>
            )}
          </ListPageSection>

          {ledgerFor ? (
            <ListPageSection
              title={`Stock activity — ${ledgerFor.name}`}
              description={`Dated stock movements for ${locationLabel}. History cannot be edited.`}
            >
              {visibleLedgerState.phase === "loading" ? (
                <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                  Loading ledger…
                </p>
              ) : visibleLedgerState.phase === "error" ? (
                <Alert variant="destructive">
                  <AlertTitle>Ledger could not be loaded</AlertTitle>
                  <AlertDescription>
                    {visibleLedgerState.message}
                    {visibleLedgerState.requestId ? (
                      <>
                        <br />
                        <span className="font-mono text-xs">
                          Request reference: {visibleLedgerState.requestId}
                        </span>
                      </>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : visibleLedgerState.phase === "ready" &&
                visibleLedgerState.page.items.length === 0 ? (
                <p className="p-5 text-sm text-[var(--fm-text-muted)]">No ledger entries yet.</p>
              ) : visibleLedgerState.phase === "ready" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleLedgerState.page.items.map((entry) => (
                      <TableRow key={entry.entryId}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatActivityDate(entry.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {entry.movementType === "MANUAL_ADJUSTMENT"
                            ? entry.quantityDeltaBase >= 0
                              ? "Stock added"
                              : "Stock removed"
                            : entry.movementType.replaceAll("_", " ").toLowerCase()}
                        </TableCell>
                        <TableCell className="text-xs font-semibold">
                          {entry.quantityDeltaBase > 0 ? "+" : ""}
                          {entry.quantityDeltaBase} {ledgerFor.baseUnitSymbol}
                        </TableCell>
                        <TableCell className="max-w-64 truncate text-xs">
                          {entry.reasonCode ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              <AdminCursorPagination
                pageNumber={ledgerPagination.pageNumber}
                nextCursor={
                  visibleLedgerState.phase === "ready" ? visibleLedgerState.page.nextCursor : null
                }
                onPrevious={ledgerPagination.previous}
                onNext={ledgerPagination.next}
              />
            </ListPageSection>
          ) : null}
          <AdminConfirmationDialog
            open={confirming !== null}
            title={
              confirming?.movement === "ADD" ? "Confirm stock addition" : "Confirm stock removal"
            }
            resource={
              confirming
                ? `${confirming.productName} · ${adjustQuantity[confirming.poolId] ?? ""} ${confirming.baseUnitSymbol}`
                : "Inventory balance"
            }
            scope={locationLabel}
            consequence="This changes sellable stock and records the current date, staff actor, and reason in immutable activity history."
            pending={adjustmentIntent.pending}
            onCancel={() => setConfirming(null)}
            onConfirm={(confirmedReason) =>
              confirming &&
              void adjust(
                confirming.poolId,
                confirming.version,
                confirming.movement,
                confirmedReason,
              )
            }
          />
        </>
      ) : null}
    </div>
  );
}
