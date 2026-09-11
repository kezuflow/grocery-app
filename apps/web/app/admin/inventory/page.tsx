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
  const [unresolved, setUnresolved] = useState<StockCommand | null>(null);
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
          setLedgerFor({
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
    if (!locationId || !confirming || unresolved || adjustmentIntent.pending) return;
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
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Inventory"
        description="Add or remove stock for the selected location. Every change records its date, reason, and staff actor."
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
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 text-sm"
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
                <Table className="block sm:table" aria-label="Stock levels">
                  <TableHeader className="hidden sm:table-header-group">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>On hand</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Update stock</TableHead>
                      <TableHead>Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block sm:table-row-group">
                    {state.page.items.map((item) => (
                      <TableRow
                        key={item.inventoryPoolId}
                        className="grid grid-cols-2 gap-3 p-4 sm:table-row sm:p-0 [&>td]:min-w-0 [&>td]:p-0 sm:[&>td]:px-4 sm:[&>td]:py-3"
                      >
                        <TableCell className="col-span-2 whitespace-normal font-medium">
                          <span>{item.productName}</span>
                          {item.stockKind === "BULK" ? (
                            <span className="block text-xs text-muted-foreground">
                              Bulk goods awaiting size counts
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="block text-[var(--fm-text-muted)] sm:hidden">
                            On hand
                          </span>
                          {item.onHandBase} {item.baseUnitSymbol}
                          <span className="block text-[var(--fm-text-muted)]">
                            {item.reservedBase} reserved · {item.heldBase ?? "Unknown"} held
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          <span className="block text-[var(--fm-text-muted)] sm:hidden">
                            Available
                          </span>
                          {item.availableBase ?? "Unavailable"} {item.baseUnitSymbol}
                        </TableCell>
                        <TableCell className="col-span-2">
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
                        <TableCell className="col-span-2">
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
