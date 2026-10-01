"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  AdminDeliveryOperationView,
  AdminOrderDetail,
  RpcResult,
} from "@freshmarkets/contracts";
import { DeliveryTrackingMap } from "@/components/maps/delivery-tracking-map";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";
import { Button } from "@/components/admin/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/admin/shadcn/dialog";
import { Separator } from "@/components/admin/shadcn/separator";
import { Skeleton } from "@/components/admin/shadcn/skeleton";
import { RiderContact } from "./rider-contact";

type OrderDetailState =
  | { phase: "loading" }
  | { phase: "ready"; detail: AdminOrderDetail }
  | { phase: "unavailable" };

export function DeliveryTrackingDialog({
  item,
  locationId,
  statusLabel,
  canReadOrder,
  onClose,
}: {
  item: AdminDeliveryOperationView;
  locationId: string;
  statusLabel: string;
  canReadOrder: boolean;
  onClose(): void;
}) {
  const [orderState, setOrderState] = useState<OrderDetailState>({ phase: "loading" });

  useEffect(() => {
    if (!canReadOrder) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(item.orderId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as RpcResult<AdminOrderDetail>;
        if (controller.signal.aborted) return;
        if (!result.ok || result.value.orderId !== item.orderId)
          throw new Error("Order detail unavailable");
        setOrderState({ phase: "ready", detail: result.value });
      } catch {
        if (!controller.signal.aborted) setOrderState({ phase: "unavailable" });
      }
    };
    void load();
    return () => controller.abort();
  }, [canReadOrder, item.orderId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(94dvh,920px)] w-[min(96vw,1420px)] max-w-none flex-col overflow-hidden sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Track Delivery</DialogTitle>
          <DialogDescription>
            Order{" "}
            {orderState.phase === "ready"
              ? orderState.detail.orderNumber || item.orderId
              : item.orderId}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,390px)] lg:overflow-hidden">
          <section className="min-w-0 lg:overflow-y-auto" aria-label="Delivery map and contacts">
            <DeliveryTrackingMap
              endpoint={`/api/admin/delivery-tracking?${new URLSearchParams({ locationId, orderId: item.orderId })}`}
              mapClassName="h-[min(48dvh,420px)] min-h-64 w-full overflow-hidden rounded-md lg:h-[min(65dvh,620px)]"
              renderContact={(contact) => (
                <RiderContact contact={contact} recipient={item.recipient} />
              )}
            />
          </section>
          <aside
            className="flex min-w-0 flex-col gap-5 lg:overflow-y-auto"
            aria-label="Order details and timeline"
          >
            <Separator className="lg:hidden" />
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold">Order timeline</h3>
              <p className="text-sm text-muted-foreground">Current delivery: {statusLabel}</p>
            </div>
            {canReadOrder ? (
              orderState.phase === "loading" ? (
                <div
                  className="flex flex-col gap-3"
                  role="status"
                  aria-label="Loading order timeline"
                >
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
              ) : orderState.phase === "ready" && orderState.detail.timeline.length > 0 ? (
                <ol aria-label="Order timeline" className="flex flex-col gap-0">
                  {orderState.detail.timeline.map((entry) => (
                    <li
                      key={entry.eventId}
                      className="flex gap-3 border-l-2 border-border pb-5 pl-4 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm font-medium">{entry.label}</span>
                        <time className="text-xs text-muted-foreground" dateTime={entry.occurredAt}>
                          {new Date(entry.occurredAt).toLocaleString()}
                        </time>
                        {entry.status ? (
                          <span className="text-xs text-muted-foreground">{entry.status}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : orderState.phase === "ready" ? (
                <p className="text-sm text-muted-foreground">No Order events are recorded yet.</p>
              ) : (
                <Alert>
                  <AlertTitle>Order timeline unavailable</AlertTitle>
                  <AlertDescription>Open the Order detail to try again.</AlertDescription>
                </Alert>
              )
            ) : (
              <Alert>
                <AlertTitle>Order timeline unavailable</AlertTitle>
                <AlertDescription>This role cannot view Order details.</AlertDescription>
              </Alert>
            )}
            {canReadOrder ? (
              <Button asChild variant="outline">
                <Link href={`/admin/orders/${encodeURIComponent(item.orderId)}`}>
                  Open Order detail
                </Link>
              </Button>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
