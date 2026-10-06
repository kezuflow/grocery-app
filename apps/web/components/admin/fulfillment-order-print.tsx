"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminOrderDetail, FulfillmentQueuePage, RpcResult } from "@freshmarkets/contracts";
import { Button } from "./shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./shadcn/dialog";
import { Alert, AlertDescription, AlertTitle } from "./shadcn/alert";
import { orderReceiptDocument } from "./order-receipt-document";

export function FulfillmentOrderPrint({
  orderIds,
  queueUrl,
  locationId,
  locationLabel,
  timezone,
  disabled,
  onClear,
}: {
  orderIds: readonly string[];
  queueUrl: string;
  locationId: string;
  locationLabel: string;
  timezone: string;
  disabled: boolean;
  onClear(): void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<{ selection: string; html: string } | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const controller = useRef<AbortController | null>(null);
  const selection = orderIds.join("\n");
  const currentDocument = !disabled && document?.selection === selection ? document : null;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (disabled) {
      controller.current?.abort();
      setOpen(false);
      setDocument(null);
      setLoading(false);
    }
  }, [disabled]);

  async function prepare() {
    if (disabled || orderIds.length === 0 || orderIds.length > 50) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setOpen(true);
    setLoading(true);
    setError(null);
    setDocument(null);
    setFrameReady(false);
    try {
      const queue = (await (
        await fetch(queueUrl, { signal: request.signal, cache: "no-store" })
      ).json()) as RpcResult<FulfillmentQueuePage>;
      if (!queue.ok) throw new Error(queue.error.message);
      if (!orderIds.every((id) => queue.value.items.some((item) => item.orderId === id)))
        throw new Error(
          "Some selected orders are no longer in this view. Close this preview and refresh the queue before printing.",
        );
      const orders: AdminOrderDetail[] = [];
      for (let start = 0; start < orderIds.length; start += 4) {
        const batch = await Promise.all(
          orderIds.slice(start, start + 4).map(async (id) => {
            const result = (await (
              await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
                signal: request.signal,
                cache: "no-store",
              })
            ).json()) as RpcResult<AdminOrderDetail>;
            if (!result.ok) throw new Error(result.error.message);
            const order = result.value;
            if (order.orderId !== id || order.fulfillment?.locationId !== locationId)
              throw new Error(
                "An order's fulfillment location could not be verified. Refresh the queue before printing.",
              );
            if (
              ["CANCELED", "REFUNDED"].includes(order.status) ||
              order.fulfillmentStatus === "CANCELED" ||
              ["PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus ?? "") ||
              order.payments.some(
                (payment) =>
                  (payment.purpose === "GROCERY_CHECKOUT" ||
                    order.amendments.some(
                      (addition) =>
                        addition.status === "COMMITTED" &&
                        addition.paymentIntentId === payment.paymentIntentId,
                    )) &&
                  (payment.refundedMinor > 0 ||
                    ["PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)),
              )
            )
              throw new Error(
                "A selected order was canceled or refunded. Refresh the queue before printing.",
              );
            return order;
          }),
        );
        orders.push(...batch);
      }
      if (!request.signal.aborted)
        setDocument({ selection, html: orderReceiptDocument(orders, locationLabel, timezone) });
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Receipts could not be loaded. Try again.",
        );
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  return (
    <>
      <span role="status">{orderIds.length} selected</span>
      <Button
        type="button"
        size="sm"
        disabled={disabled || orderIds.length === 0}
        onClick={() => void prepare()}
      >
        Print selected orders
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || orderIds.length === 0}
        onClick={onClear}
      >
        Clear selection
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            controller.current?.abort();
            setLoading(false);
            setDocument(null);
          }
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Print order receipts</DialogTitle>
            <DialogDescription>
              Review the selected orders. Each order starts on a separate printed page.
            </DialogDescription>
          </DialogHeader>
          {loading ? <p role="status">Loading {orderIds.length} order receipts…</p> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Receipts could not be prepared</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!loading && !error && !currentDocument ? (
            <p role="status">The selection changed. Load the current selected orders again.</p>
          ) : null}
          {currentDocument ? (
            <iframe
              ref={frame}
              title="Selected order receipts"
              sandbox="allow-same-origin allow-modals"
              srcDoc={currentDocument.html}
              className="h-[min(65vh,48rem)] w-full rounded-md border"
              onLoad={() => setFrameReady(true)}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || loading || orderIds.length === 0}
              onClick={() => void prepare()}
            >
              Reload receipts
            </Button>
            <Button
              type="button"
              disabled={disabled || loading || !currentDocument || !frameReady}
              onClick={() => {
                try {
                  if (!frame.current?.contentWindow) throw new Error();
                  frame.current.contentWindow.focus();
                  frame.current.contentWindow.print();
                } catch {
                  setError("Printing could not start. Try again.");
                }
              }}
            >
              Print {orderIds.length} {orderIds.length === 1 ? "order" : "orders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
