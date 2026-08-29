"use client";
import { useCallback, useEffect, useState } from "react";
import type { ProcurementRequirementPage, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
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
export default function ProcurementPage() {
  const { locationId, label } = useAdminLocation();
  const [page, setPage] = useState<ProcurementRequirementPage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [cycleId, setCycleId] = useState("");
  const [inventoryPoolId, setInventoryPoolId] = useState("");
  const [version, setVersion] = useState("");
  const aggregateIntent = useAdminCommandIntent();
  const pagination = useAdminPagination();
  const load = useCallback(
    async (cursor: string | null) => {
      setState("loading");
      try {
        const payload = (await (
          await fetch(
            `/api/admin/procurement?locationId=${locationId ?? ""}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
        ).json()) as RpcResult<ProcurementRequirementPage>;
        if (!payload.ok) {
          setNotice(
            payload.error.code === "FORBIDDEN"
              ? "Procurement access is not permitted for this scope."
              : payload.error.message,
          );
          setState("error");
          return;
        }
        setPage(payload.value);
        setState("ready");
      } catch {
        setNotice("Network error loading procurement requirements.");
        setState("error");
      }
    },
    [locationId],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
  }, [load, locationId, pagination.cursor]);
  async function aggregate() {
    const expectedVersion = Number(version);
    if (
      !cycleId.trim() ||
      !inventoryPoolId.trim() ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      setNotice("Cycle, inventory pool, and current version are required.");
      return;
    }
    if (!locationId) return;
    let payload: RpcResult<unknown>;
    try {
      payload = await aggregateIntent.submit(async (idempotencyKey) => {
        const response = await fetch("/api/admin/procurement/aggregate", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            locationId,
            cycleId: cycleId.trim(),
            inventoryPoolId: inventoryPoolId.trim(),
            expectedVersion,
          }),
        });
        return (await response.json()) as RpcResult<unknown>;
      });
    } catch {
      setNotice("Connection lost. Retry to safely reuse the same aggregation request.");
      return;
    }
    setNotice(payload.ok ? "Procurement demand aggregated." : payload.error.message);
    if (payload.ok || payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT")
      void load(pagination.cursor);
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Procurement"
        description={`Turn committed demand into explicit procurement requirements for ${label}.`}
      />
      {state === "loading" ? (
        <div role="status" aria-label="Loading procurement">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Procurement could not be loaded</AlertTitle>
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
        <>
          <ListPageSection
            title="Aggregate demand"
            description="Use the current aggregate version; Core preserves idempotency and scope."
          >
            <div className="grid gap-2 p-4 sm:grid-cols-4">
              <Input
                aria-label="Cycle ID"
                placeholder="cycle id"
                value={cycleId}
                onChange={(event) => setCycleId(event.target.value)}
              />
              <Input
                aria-label="Inventory pool ID"
                placeholder="inventory pool id"
                value={inventoryPoolId}
                onChange={(event) => setInventoryPoolId(event.target.value)}
              />
              <Input
                aria-label="Current requirement version"
                placeholder="current version"
                inputMode="numeric"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
              <Button
                disabled={aggregateIntent.pending || !locationId}
                onClick={() => void aggregate()}
              >
                {aggregateIntent.pending ? "Working…" : "Aggregate"}
              </Button>
            </div>
          </ListPageSection>
          <ListPageSection
            title="Requirement queue"
            description="Quantities are authoritative integer base units."
          >
            {notice ? (
              <p role="status" className="border-b p-3 text-sm">
                {notice}
              </p>
            ) : null}
            {page.items.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">
                No procurement requirements for this location.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Accepted / Rejected</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.items.map((item) => (
                      <TableRow key={item.requirementId}>
                        <TableCell className="font-mono text-xs">{item.requirementId}</TableCell>
                        <TableCell>{item.cycleId}</TableCell>
                        <TableCell>{item.requiredQuantityBase}</TableCell>
                        <TableCell>
                          {item.acceptedBase} / {item.rejectedBase}
                        </TableCell>
                        <TableCell>
                          <StatusBadge>{item.status}</StatusBadge>
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
        </>
      ) : null}
    </div>
  );
}
