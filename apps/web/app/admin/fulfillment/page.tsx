"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { FulfillmentQueuePage, RpcResult } from "@freshmarkets/contracts";
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
import { AdminPageState } from "../../../components/admin/admin-page-state";

const actionLabels: Record<string, string> = {
  START_PICKING: "Accept order & start picking",
  MARK_READY_TO_PACK: "Finish picking",
  START_PACKING: "Start packing",
  MARK_PACKED: "Finish packing",
  HAND_OFF: "Hand over order",
  COMPLETE: "Complete fulfillment",
  RECORD_SHORTAGE: "Report shortage",
  RESUME_PICKING: "Resume picking",
  RESUME_READY_TO_PACK: "Resume packing preparation",
  CANCEL: "Cancel fulfillment",
  ESCALATE: "Escalate shortage",
};

export default function FulfillmentPage() {
  const { locationId, label } = useAdminLocation();
  const orderId = useSearchParams().get("orderId");
  const [page, setPage] = useState<FulfillmentQueuePage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const actionIntent = useAdminCommandIntent();
  const pagination = useAdminPagination(`${locationId}:${orderId}`);
  const load = useCallback(
    async (cursor: string | null) => {
      setState("loading");
      try {
        const payload = (await (
          await fetch(
            `/api/admin/fulfillment?locationId=${locationId ?? ""}&limit=50${orderId ? `&orderId=${encodeURIComponent(orderId)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
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
        setState("ready");
      } catch {
        setNotice("Network error loading fulfillment.");
        setState("error");
      }
    },
    [locationId, orderId],
  );
  useEffect(() => {
    if (locationId) void load(pagination.cursor);
  }, [load, locationId, pagination.cursor]);
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
  }
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Fulfillment"
        description="Accept paid orders, pick items and complete packing. Accepting an Instant order closes customer cancellation; Scheduled cancellation closes at cutoff."
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
        <ListPageSection title="Work queue" description={`Current location: ${label}.`}>
          {page.items.length > 0 ? (
            <div className="p-4">
              <Input
                aria-label="Fulfillment action reason"
                placeholder="Describe a shortage when reporting one"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : null}
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
                    <TableRow key={item.orderId}>
                      <TableCell className="font-mono text-xs">{item.orderId}</TableCell>
                      <TableCell>{item.cycleId ?? "Instant"}</TableCell>
                      <TableCell>{item.locationId}</TableCell>
                      <TableCell>
                        <StatusBadge>{item.status}</StatusBadge>
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-1">
                        {item.allowedActions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "MARK_PACKED" ? "default" : "outline"}
                            disabled={actionIntent.pending}
                            onClick={() => void act(item.orderId, action, item.version)}
                          >
                            {actionLabels[action] ?? action}
                          </Button>
                        ))}
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
      ) : null}
    </div>
  );
}
