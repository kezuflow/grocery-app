"use client";
import { InventoryCountForm } from "../../../components/admin/inventory-count-form";
import { useCallback, useEffect, useRef, useState } from "react";
import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
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
import { useAdminRouteGuard } from "../../../components/admin/use-admin-route-guard";
import { notifyCommandSuccess } from "../../../components/admin/admin-feedback";
import { useAdminLocation } from "../../../components/admin/use-admin-location";
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

type LoadState =
  | { phase: "loading"; key: string }
  | { phase: "error"; key: string; message: string; requestId: string | null }
  | { phase: "ready"; key: string; page: AdminInventoryPage };

type LedgerLoadState =
  | { phase: "idle" }
  | { phase: "loading"; key: string }
  | { phase: "error"; key: string; message: string; requestId: string | null }
  | { phase: "ready"; key: string; page: AdminInventoryLedgerPage };

type StockMovement = "ADD" | "REMOVE";
type StockCommand = {
  locationId: string;
  poolId: string;
  productName: string;
  baseUnitSymbol: string;
  movement: StockMovement;
  body: string;
};
const adjustmentResult = z.union([
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      locationId: z.string(),
      inventoryPoolId: z.string(),
      onHandBase: z.number().int().safe().nonnegative(),
      reservedBase: z.number().int().safe().nonnegative(),
      version: z.number().int().safe().positive(),
      ledgerEntryId: z.string(),
    }),
  }),
]);

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function stockQuantity(value: number | null | undefined, unit: string): string {
  return value == null ? "Unavailable" : `${value.toLocaleString("en-PH")} ${unit}`;
}

function signedStockQuantity(value: number, unit: string): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-PH")} ${unit}`;
}

export default function InventoryPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading", key: "" });
  const loadRequest = useRef(0);
  const ledgerRequest = useRef(0);
  const { locationId, label: locationLabel } = useAdminLocation();
  const [ledgerFor, setLedgerFor] = useState<{
    locationId: string;
    poolId: string;
    name: string;
    baseUnitSymbol: string;
  } | null>(null);
  const [ledgerState, setLedgerState] = useState<LedgerLoadState>({ phase: "idle" });
  const [ledgerReloadVersion, setLedgerReloadVersion] = useState(0);
  const [adjustQuantity, setAdjustQuantity] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    locationId: string;
    poolId: string;
    productName: string;
    baseUnitSymbol: string;
    version: number;
    movement: StockMovement;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const adjustmentIntent = useAdminCommandIntent();
  useAdminRouteGuard(false, adjustmentIntent.pending || adjustmentIntent.uncertain);
  const [unresolved, setUnresolved] = useState<StockCommand | null>(null);
  const pagination = useAdminPagination(locationId);
  const pageKey = JSON.stringify([locationId, pagination.cursor]);
  const visibleState: LoadState =
    state.key === pageKey ? state : { phase: "loading", key: pageKey };
  const activeLedgerFor = ledgerFor?.locationId === locationId ? ledgerFor : null;
  const ledgerPagination = useAdminPagination(
    `${locationId ?? "no-location"}:${activeLedgerFor?.poolId ?? "no-pool"}`,
  );

  useEffect(() => {
    ledgerRequest.current += 1;
    setLedgerFor(null);
    setConfirming(null);
    setAdjustQuantity({});
    setNotice(null);
  }, [locationId]);

  const load = useCallback((location: string, cursor: string | null) => {
    const requestNumber = loadRequest.current + 1;
    const key = JSON.stringify([location, cursor]);
    loadRequest.current = requestNumber;
    setState({ phase: "loading", key });
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
            key,
            message:
              payload.error.code === "FORBIDDEN"
                ? "Inventory reads require the inventory.read capability and scope over this location."
                : payload.error.message,
            requestId: payload.error.requestId,
          });
          return;
        }
        if (payload.value.items.some((item) => item.locationId !== location)) {
          setState({
            phase: "error",
            key,
            message: "Inventory returned a different location. Reload this scope.",
            requestId: null,
          });
          return;
        }
        setState({ phase: "ready", key, page: payload.value });
      } catch {
        if (loadRequest.current !== requestNumber) return;
        setState({
          phase: "error",
          key,
          message: "Network error loading inventory.",
          requestId: null,
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (locationId) load(locationId, pagination.cursor);
  }, [load, locationId, pagination.cursor]);

  function loadLedger(poolId: string, name: string, baseUnitSymbol: string) {
    if (!locationId) return;
    setLedgerFor({ locationId, poolId, name, baseUnitSymbol });
    setLedgerState({ phase: "idle" });
    ledgerPagination.reset();
  }

  useEffect(() => {
    if (!activeLedgerFor || !locationId) return;
    const controller = new AbortController();
    const key = `${locationId}:${activeLedgerFor.poolId}:${ledgerPagination.cursor ?? ""}`;
    const requestNumber = ledgerRequest.current + 1;
    ledgerRequest.current = requestNumber;
    setLedgerState({ phase: "loading", key });
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/inventory/${encodeURIComponent(activeLedgerFor.poolId)}/ledger?locationId=${encodeURIComponent(locationId)}&limit=20${ledgerPagination.cursor ? `&cursor=${encodeURIComponent(ledgerPagination.cursor)}` : ""}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as RpcResult<AdminInventoryLedgerPage>;
        if (controller.signal.aborted || ledgerRequest.current !== requestNumber) return;
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
        if (!controller.signal.aborted && ledgerRequest.current === requestNumber) {
          setLedgerState({
            phase: "error",
            key,
            message: "Network error loading the inventory ledger.",
            requestId: null,
          });
        }
      }
    })();
    return () => controller.abort();
  }, [activeLedgerFor, ledgerPagination.cursor, ledgerReloadVersion, locationId]);

  const ledgerKey =
    activeLedgerFor && locationId
      ? `${locationId}:${activeLedgerFor.poolId}:${ledgerPagination.cursor ?? ""}`
      : null;
  const visibleLedgerState: LedgerLoadState =
    ledgerKey && "key" in ledgerState && ledgerState.key === ledgerKey
      ? ledgerState
      : ledgerKey
        ? { phase: "loading", key: ledgerKey }
        : { phase: "idle" };

  async function submit(command: StockCommand) {
    setUnresolved(command);
    setConfirming(null);
    try {
      const payload = await adjustmentIntent.submit(async (idempotencyKey) => {
        const response = await fetch(
          `/api/admin/inventory/${encodeURIComponent(command.poolId)}/adjustments`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: command.body,
          },
        );
        return adjustmentResult.parse(await response.json());
      });
      setUnresolved(null);
      setNotice(
        payload.ok
          ? command.movement === "ADD"
            ? "Stock added. The dated activity entry is shown below."
            : "Stock removed. The dated activity entry is shown below."
          : payload.error.message,
      );
      if (locationId === command.locationId) {
        if (payload.ok) {
          notifyCommandSuccess("Stock adjusted");
          setLedgerFor({
            locationId: command.locationId,
            poolId: command.poolId,
            name: command.productName,
            baseUnitSymbol: command.baseUnitSymbol,
          });
          setAdjustQuantity({});
          setLedgerReloadVersion((current) => current + 1);
        }
        load(command.locationId, pagination.cursor);
      }
    } catch {
      setNotice(
        "The stock result is unknown. Retry the saved adjustment before changing more stock.",
      );
    }
  }
  async function adjust(
    poolId: string,
    expectedVersion: number,
    movement: StockMovement,
    reason: string,
  ) {
    if (
      !locationId ||
      !confirming ||
      confirming.locationId !== locationId ||
      unresolved ||
      adjustmentIntent.pending
    )
      return;
    const quantity = Number(adjustQuantity[poolId]);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setNotice("Enter a whole-number quantity greater than zero.");
      return;
    }
    await submit({
      locationId,
      poolId,
      productName: confirming.productName,
      baseUnitSymbol: confirming.baseUnitSymbol,
      movement,
      body: JSON.stringify({
        locationId,
        inventoryPoolId: poolId,
        operation: movement,
        quantityBase: quantity,
        reason,
        expectedVersion,
      }),
    });
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Inventory"
        description="Review physical, reserved, held, and available stock at the selected location. Adjustments record a date, reason, and staff actor."
      />

      {unresolved ? (
        <Alert>
          <AlertTitle>Stock adjustment needs recovery</AlertTitle>
          <AlertDescription>
            {unresolved.productName}: the saved quantities, location and request key are retained.
            <Button disabled={adjustmentIntent.pending} onClick={() => void submit(unresolved)}>
              Retry saved adjustment
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!locationId ? (
        <Alert>
          <AlertTitle>Location scope required</AlertTitle>
          <AlertDescription>
            Choose a location in the Admin header to inspect and update inventory.
          </AlertDescription>
        </Alert>
      ) : null}

      {locationId && visibleState.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading inventory">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {locationId && visibleState.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Inventory could not be loaded</AlertTitle>
          <AlertDescription>
            {visibleState.message}
            {visibleState.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">
                  Request reference: {visibleState.requestId}
                </span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {locationId && visibleState.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection
            title="Stock levels"
            description={`${locationLabel}. Available is physical stock after reservations and checkout holds. Enter a positive quantity to adjust stock.`}
          >
            {visibleState.page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                No inventory records for this location.
              </p>
            ) : (
              <>
                <Table className="block lg:table" aria-label="Stock levels">
                  <TableHeader className="hidden lg:table-header-group">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Physical</TableHead>
                      <TableHead>Reserved</TableHead>
                      <TableHead>Checkout holds</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Update stock</TableHead>
                      <TableHead>Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block lg:table-row-group">
                    {visibleState.page.items.map((item) => (
                      <TableRow
                        key={item.inventoryPoolId}
                        className="grid grid-cols-2 gap-3 border-b border-[var(--fm-border)] p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:p-0 lg:[&>td]:px-3 lg:[&>td]:py-3"
                      >
                        <TableCell className="col-span-2 whitespace-normal font-medium">
                          <span>{item.productName}</span>
                          {item.stockKind === "BULK" ? (
                            <span className="block text-xs text-muted-foreground">
                              Bulk goods awaiting size counts
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">
                            Physical
                          </span>
                          {stockQuantity(item.onHandBase, item.baseUnitSymbol)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">
                            Reserved
                          </span>
                          {stockQuantity(item.reservedBase, item.baseUnitSymbol)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">
                            Checkout holds
                          </span>
                          {stockQuantity(item.heldBase, item.baseUnitSymbol)}
                        </TableCell>
                        <TableCell className="text-sm font-semibold tabular-nums">
                          <span className="block font-normal text-[var(--fm-text-muted)] lg:hidden">
                            Available
                          </span>
                          {stockQuantity(item.availableBase, item.baseUnitSymbol)}
                        </TableCell>
                        <TableCell className="col-span-2 lg:col-span-1">
                          <span className="mb-1 block text-sm text-[var(--fm-text-muted)] lg:hidden">
                            Adjustment quantity
                          </span>
                          <Input
                            aria-label={`Stock quantity for ${item.productName}`}
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            placeholder="0"
                            disabled={unresolved !== null}
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
                        <TableCell className="col-span-2 lg:col-span-1">
                          <span className="flex flex-wrap items-center gap-2">
                            {item.stockKind !== "COUNTED_SIZE" ? (
                              <Button
                                size="sm"
                                disabled={adjustmentIntent.pending || unresolved !== null}
                                onClick={() => {
                                  const quantity = Number(adjustQuantity[item.inventoryPoolId]);
                                  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
                                    setNotice("Enter a whole-number quantity greater than zero.");
                                    return;
                                  }
                                  setConfirming({
                                    locationId: item.locationId,
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
                            ) : null}
                            {item.stockKind === "BULK" && !unresolved ? (
                              <InventoryCountForm
                                item={item}
                                onSaved={() => load(locationId, pagination.cursor)}
                              />
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={adjustmentIntent.pending || unresolved !== null}
                              onClick={() => {
                                const quantity = Number(adjustQuantity[item.inventoryPoolId]);
                                if (!Number.isSafeInteger(quantity) || quantity <= 0) {
                                  setNotice("Enter a whole-number quantity greater than zero.");
                                  return;
                                }
                                setConfirming({
                                  locationId: item.locationId,
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
                        <TableCell className="col-span-2 lg:col-span-1">
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
                  nextCursor={visibleState.page.nextCursor}
                  onPrevious={pagination.previous}
                  onNext={pagination.next}
                />
              </>
            )}
          </ListPageSection>

          {activeLedgerFor ? (
            <ListPageSection
              title={`Stock activity — ${activeLedgerFor.name}`}
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
                <Table className="block lg:table" aria-label="Stock activity">
                  <TableHeader className="hidden lg:table-header-group">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Physical change</TableHead>
                      <TableHead>Reservation / hold change</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block lg:table-row-group">
                    {visibleLedgerState.page.items.map((entry) => (
                      <TableRow
                        key={entry.entryId}
                        className="grid grid-cols-2 gap-3 border-b border-[var(--fm-border)] p-4 lg:table-row lg:p-0 [&>td]:min-w-0 [&>td]:p-0 lg:[&>td]:px-4 lg:[&>td]:py-3"
                      >
                        <TableCell className="col-span-2 text-sm lg:whitespace-nowrap">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">Date</span>
                          {formatActivityDate(entry.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">Type</span>
                          {entry.movementType === "MANUAL_ADJUSTMENT"
                            ? entry.quantityDeltaBase >= 0
                              ? "Stock added"
                              : "Stock removed"
                            : entry.movementType.replaceAll("_", " ").toLowerCase()}
                        </TableCell>
                        <TableCell className="text-sm font-semibold tabular-nums">
                          <span className="block font-normal text-[var(--fm-text-muted)] lg:hidden">
                            Physical change
                          </span>
                          {signedStockQuantity(
                            entry.quantityDeltaBase,
                            activeLedgerFor.baseUnitSymbol,
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">
                            Reservation / hold change
                          </span>
                          {signedStockQuantity(
                            entry.reservationDeltaBase,
                            activeLedgerFor.baseUnitSymbol,
                          )}
                        </TableCell>
                        <TableCell className="col-span-2 whitespace-normal break-words text-sm">
                          <span className="block text-[var(--fm-text-muted)] lg:hidden">
                            Reason
                          </span>
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
            open={confirming !== null && confirming.locationId === locationId}
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
