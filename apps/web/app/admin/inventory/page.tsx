"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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

export default function InventoryPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const loadRequest = useRef(0);
  const ledgerRequest = useRef(0);
  const { locationId, label: locationLabel } = useAdminLocation();
  const [ledgerFor, setLedgerFor] = useState<{ poolId: string; name: string } | null>(null);
  const [ledgerState, setLedgerState] = useState<LedgerLoadState>({ phase: "idle" });
  const [adjustDelta, setAdjustDelta] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    poolId: string;
    productName: string;
    baseUnitSymbol: string;
    version: number;
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

  function loadLedger(poolId: string, name: string) {
    setLedgerFor({ poolId, name });
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
  }, [ledgerFor, ledgerPagination.cursor, locationId]);

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

  async function adjust(poolId: string, expectedVersion: number, reason: string) {
    if (!locationId) {
      setNotice("Select an explicit location scope before adjusting inventory.");
      return;
    }
    const delta = Number(adjustDelta[poolId]);
    if (Number.isNaN(delta) || !Number.isInteger(delta)) {
      setNotice("An integer delta and a reason are required.");
      return;
    }
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
              delta,
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
          ? "Adjustment applied."
          : (payload.error?.message ?? "Version conflict; refresh."),
      );
      if (payload.ok) {
        setAdjustDelta({});
        setConfirming(null);
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
        description="Location balances in base units. Adjustments are guarded, idempotent, and write ledger evidence."
      />

      {!locationId ? (
        <Alert>
          <AlertTitle>Location scope required</AlertTitle>
          <AlertDescription>
            {locationLabel} in the Admin header to inspect inventory.
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

          <ListPageSection title="Location">
            <p className="p-4 text-sm">{locationLabel}</p>
          </ListPageSection>

          <ListPageSection title="Balances" description="On-hand minus reserved is sellable stock.">
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
                      <TableHead>Reserved</TableHead>
                      <TableHead>Adjust ±</TableHead>
                      <TableHead>
                        <span className="sr-only">Ledger link</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.page.items.map((item) => (
                      <TableRow key={item.inventoryPoolId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-xs">
                          {item.onHandBase} {item.baseUnitSymbol}
                        </TableCell>
                        <TableCell className="text-xs">{item.reservedBase}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1">
                            <Input
                              aria-label={`Adjustment delta for ${item.productName}`}
                              value={adjustDelta[item.inventoryPoolId] ?? ""}
                              onChange={(event) =>
                                setAdjustDelta({
                                  ...adjustDelta,
                                  [item.inventoryPoolId]: event.target.value,
                                })
                              }
                              className="w-20"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={adjustmentIntent.pending}
                              onClick={() => {
                                const delta = Number(adjustDelta[item.inventoryPoolId]);
                                if (!Number.isInteger(delta)) {
                                  setNotice("Enter an integer adjustment before confirmation.");
                                  return;
                                }
                                setConfirming({
                                  poolId: item.inventoryPoolId,
                                  productName: item.productName,
                                  baseUnitSymbol: item.baseUnitSymbol,
                                  version: item.version,
                                });
                              }}
                            >
                              Apply
                            </Button>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadLedger(item.inventoryPoolId, item.productName)}
                          >
                            Ledger
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="px-4 pb-3 text-xs text-[var(--fm-text-muted)]">
                  Adjustments use the guarded command; confirmation requires a reason and a version
                  conflict asks you to refresh.
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
              title={`Ledger — ${ledgerFor.name}`}
              description="Append-only movement evidence for this pool at this location."
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
                      <TableHead>When</TableHead>
                      <TableHead>Movement</TableHead>
                      <TableHead>Δ Quantity</TableHead>
                      <TableHead>Δ Reserved</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleLedgerState.page.items.map((entry) => (
                      <TableRow key={entry.entryId}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {entry.createdAt.replace("T", " ").replace(/\.\d+Z$/, "Z")}
                        </TableCell>
                        <TableCell className="text-xs">{entry.movementType}</TableCell>
                        <TableCell className="text-xs font-semibold">
                          {entry.quantityDeltaBase}
                        </TableCell>
                        <TableCell className="text-xs">{entry.reservationDeltaBase}</TableCell>
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
              <p className="p-4 text-xs">
                <Link href="/admin" className="text-[var(--fm-info)] underline">
                  Back to overview
                </Link>
              </p>
            </ListPageSection>
          ) : null}
          <AdminConfirmationDialog
            open={confirming !== null}
            title="Confirm inventory adjustment"
            resource={
              confirming
                ? `${confirming.productName} · ${adjustDelta[confirming.poolId] ?? ""} ${confirming.baseUnitSymbol}`
                : "Inventory balance"
            }
            scope={locationLabel}
            consequence="This writes an immutable inventory ledger movement and changes sellable stock."
            pending={adjustmentIntent.pending}
            onCancel={() => setConfirming(null)}
            onConfirm={(confirmedReason) =>
              confirming && void adjust(confirming.poolId, confirming.version, confirmedReason)
            }
          />
        </>
      ) : null}
    </div>
  );
}
