"use client";
import { useCallback, useEffect, useState } from "react";
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

const location = "location-cebu-central";
export default function FulfillmentPage() {
  const [page, setPage] = useState<FulfillmentQueuePage | null>(null);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/fulfillment?locationId=${location}&limit=50`)
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
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(orderId: string, action: string, expectedVersion: number) {
    const response = await fetch("/api/admin/fulfillment", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        locationId: location,
        orderId,
        action,
        expectedVersion,
        reason: reason.trim() || undefined,
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown>;
    setNotice(
      payload.ok ? `Fulfillment action ${action.toLowerCase()} completed.` : payload.error.message,
    );
    if (payload.ok) void load();
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Fulfillment"
        description="Location-scoped picking and packing work. Core exposes only legal next actions."
      />
      {state === "loading" ? (
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
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && page ? (
        <ListPageSection
          title="Work queue"
          description="Current location: Cebu Central. Refresh after a stale-version response."
        >
          <div className="p-4">
            <Input
              aria-label="Fulfillment action reason"
              placeholder="reason for a shortage (required by Core when applicable)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
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
                            variant={action === "PACK" ? "default" : "outline"}
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
