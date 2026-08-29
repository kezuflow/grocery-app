"use client";
import { useCallback, useEffect, useState } from "react";
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
import {
  AdminConfirmationDialog,
  AdminCursorPagination,
  useAdminPagination,
} from "../../../components/admin/admin-controls";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready"; page: AdminInventoryPage };

const DEFAULT_LOCATION = "location-cebu-central";

export default function InventoryPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [locationId, setLocationId] = useState(DEFAULT_LOCATION);
  const [ledgerFor, setLedgerFor] = useState<{ poolId: string; name: string } | null>(null);
  const [ledger, setLedger] = useState<AdminInventoryLedgerPage | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{
    poolId: string;
    productName: string;
    baseUnitSymbol: string;
    version: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const adjustmentIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const ledgerPagination = useAdminPagination();

  const load = useCallback((location: string, cursor: string | null) => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/inventory?locationId=${encodeURIComponent(location)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        const payload = (await response.json()) as RpcResult<AdminInventoryPage>;
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
        setState({ phase: "error", message: "Network error loading inventory.", requestId: null });
      }
    })();
  }, []);

  useEffect(() => load(locationId, pagination.cursor), [load, locationId, pagination.cursor]);

  function loadLedger(poolId: string, name: string) {
    setLedgerFor({ poolId, name });
    setLedger(null);
    ledgerPagination.reset();
  }

  useEffect(() => {
    if (!ledgerFor) return;
    void (async () => {
      const response = await fetch(
        `/api/admin/inventory/${encodeURIComponent(ledgerFor.poolId)}/ledger?locationId=${encodeURIComponent(locationId)}&limit=20${ledgerPagination.cursor ? `&cursor=${encodeURIComponent(ledgerPagination.cursor)}` : ""}`,
      );
      const payload = (await response.json()) as RpcResult<AdminInventoryLedgerPage>;
      setLedger(payload.ok ? payload.value : { items: [], nextCursor: null });
    })();
  }, [ledgerFor, ledgerPagination.cursor, locationId]);

  async function adjust(poolId: string, expectedVersion: number, reason: string) {
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

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading inventory">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
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

      {state.phase === "ready" ? (
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
            <div className="flex gap-2 p-4">
              <Input
                aria-label="Location ID"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="sm:w-72"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => load(locationId, pagination.cursor)}
              >
                Load
              </Button>
            </div>
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
              {ledger === null ? (
                <p className="p-5 text-sm text-[var(--fm-text-muted)]" role="status">
                  Loading ledger…
                </p>
              ) : ledger.items.length === 0 ? (
                <p className="p-5 text-sm text-[var(--fm-text-muted)]">No ledger entries yet.</p>
              ) : (
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
                    {ledger.items.map((entry) => (
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
              )}
              <AdminCursorPagination
                pageNumber={ledgerPagination.pageNumber}
                nextCursor={ledger?.nextCursor ?? null}
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
            scope={locationId}
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
