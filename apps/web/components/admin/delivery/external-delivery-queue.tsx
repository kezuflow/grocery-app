"use client";

import type { DeliveryOperationsSummary, RpcResult } from "@freshmarkets/contracts";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { ListPageSection, PageHeader, StatusBadge } from "../admin-shell";
import { useAdminLocation } from "../use-admin-location";
import { ExternalDeliveryBooking } from "./external-delivery-booking";

export function ExternalDeliveryQueue() {
  const { locationId, label } = useAdminLocation();
  const [summary, setSummary] = useState<DeliveryOperationsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    setLoading(true);
    try {
      const result = (await (
        await fetch(`/api/admin/delivery?locationId=${encodeURIComponent(locationId)}&limit=100`)
      ).json()) as RpcResult<DeliveryOperationsSummary>;
      if (result.ok) setSummary(result.value);
      else setMessage(result.error.message);
    } catch {
      setMessage("External delivery work could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    setSummary(null);
    setMessage(null);
    void load();
  }, [load]);

  async function mutate(
    dispatch: NonNullable<DeliveryOperationsSummary["items"][number]["externalDispatch"]>,
    operation: "refresh" | "cancel",
  ) {
    if (!locationId) return;
    if (operation === "cancel" && !window.confirm("Cancel this provider delivery?")) return;
    try {
      const result = (await (
        await fetch(
          `/api/admin/external-deliveries/${encodeURIComponent(dispatch.dispatchId)}/${operation}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify({ locationId, expectedVersion: dispatch.version }),
          },
        )
      ).json()) as RpcResult<unknown>;
      setMessage(result.ok ? `Provider delivery ${operation} completed.` : result.error.message);
      void load();
    } catch {
      setMessage(`Provider delivery ${operation} outcome is unknown. Refresh before retrying.`);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="External delivery"
        description={`Book and track store-scoped courier work for ${label}.`}
      />
      {message ? (
        <Alert variant="warning">
          <AlertTitle>Delivery update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? <Skeleton className="h-32 w-full" /> : null}
      {summary ? (
        <ListPageSection
          title="Courier queue"
          description="Each customer delivery is booked separately. Live driver maps and internal fleet assignment are not part of active operations."
        >
          {summary.items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--fm-text-muted)]">No open courier work.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>FreshMarkets status</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.items.map((item) => (
                    <TableRow key={item.jobId}>
                      <TableCell className="font-mono text-xs">{item.orderId}</TableCell>
                      <TableCell>{item.fulfillmentMode}</TableCell>
                      <TableCell>
                        <StatusBadge>{item.status}</StatusBadge>
                      </TableCell>
                      <TableCell>
                        {item.externalDispatch ? (
                          <div className="space-y-1 text-xs">
                            <p>
                              {item.externalDispatch.provider} · {item.externalDispatch.status}
                            </p>
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
                        ) : (
                          "Not booked"
                        )}
                      </TableCell>
                      <TableCell className="min-w-72">
                        {item.externalDispatch ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void mutate(item.externalDispatch!, "refresh")}
                            >
                              Refresh provider
                            </Button>
                            {!["COMPLETED", "CANCELED", "RETURNED"].includes(
                              item.externalDispatch.status,
                            ) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void mutate(item.externalDispatch!, "cancel")}
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <ExternalDeliveryBooking
                            locationId={item.locationId}
                            fulfillmentMode={item.fulfillmentMode}
                            delivery={{
                              jobId: item.jobId,
                              status: item.status,
                              version: item.version,
                            }}
                            disabled={false}
                            onBooked={(notice) => {
                              setMessage(notice);
                              void load();
                            }}
                          />
                        )}
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
