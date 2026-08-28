"use client";
import { useCallback, useEffect, useState } from "react";
import type { DeliveryOperationsSummary, RpcResult } from "@freshmarkets/contracts";
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
export default function DeliveryPage() {
  const { locationId, label } = useAdminLocation();
  const [data, setData] = useState<DeliveryOperationsSummary | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/delivery?locationId=${locationId ?? ""}&limit=50`)
      ).json()) as RpcResult<DeliveryOperationsSummary>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Delivery access is not permitted for this scope."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setData(payload.value);
      setState("ready");
    } catch {
      setNotice("Network error loading delivery operations.");
      setState("error");
    }
  }, [locationId]);
  useEffect(() => {
    if (locationId) void load();
  }, [load]);
  async function act(orderId: string, action: string, expectedVersion: number) {
    if (!locationId || pending) return;
    setPending(true);
    const response = await fetch("/api/admin/delivery", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        locationId,
        orderId,
        action,
        expectedVersion,
        reason: reason.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown>;
    setNotice(
      payload.ok ? `Delivery action ${action.toLowerCase()} completed.` : payload.error.message,
    );
    if (
      payload.ok ||
      (!payload.ok && (payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT"))
    )
      void load();
    setPending(false);
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Delivery"
        description={`Dispatch work by location (${label}) and committed fulfillment promise.`}
      />
      {state === "loading" ? (
        <div role="status" aria-label="Loading delivery">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Delivery could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && data ? (
        <ListPageSection
          title="Dispatch queue"
          description={`${data.totalOpenJobs} open jobs; ${data.assignedJobs} assigned. ${data.cycleId ?? "Instant delivery has no fabricated cycle."}`}
        >
          <div className="p-4">
            <Input
              aria-label="Delivery action reason"
              placeholder="reason for a delivery failure (required by Core when applicable)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          {data.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">
              No open delivery work at this location.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.jobId}>
                      <TableCell className="font-mono text-xs">{item.orderId}</TableCell>
                      <TableCell>{item.cycleId ?? "Instant"}</TableCell>
                      <TableCell>{item.riderAssigned ? "Assigned" : "Unassigned"}</TableCell>
                      <TableCell>
                        <StatusBadge>{item.status}</StatusBadge>
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-1">
                        {item.allowedActions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "DELIVER" ? "default" : "outline"}
                            disabled={pending}
                            onClick={() => void act(item.orderId, action, item.version)}
                          >
                            {action}
                          </Button>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ListPageSection>
      ) : null}
    </div>
  );
}
