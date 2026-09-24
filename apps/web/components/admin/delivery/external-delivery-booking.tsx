"use client";

import type {
  AdminDeliveryOperationView,
  ExternalDeliveryDispatchView,
  RpcResult,
} from "@freshmarkets/contracts";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { notifyCommandSuccess } from "../admin-feedback";
import { Label } from "../../ui/label";
import type { OrderedDeliveryItem } from "./delivery-order-list";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FulfillmentMode = "INSTANT" | "SCHEDULED";

async function readResult<T>(response: Response): Promise<RpcResult<T>> {
  return (await response.json()) as RpcResult<T>;
}

export function ExternalDeliveryBooking({
  locationId,
  fulfillmentMode,
  delivery,
  disabled,
  readiness,
  fetchImpl = fetch,
  onBooked,
  onInteractionState,
}: {
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  delivery: OrderedDeliveryItem;
  disabled: boolean;
  readiness: AdminDeliveryOperationView["courierPickup"];
  fetchImpl?: FetchLike;
  onBooked: (message: string) => void;
  onInteractionState?: (dirty: boolean, locked: boolean) => void;
}) {
  const [pickupKind, setPickupKind] = useState<"IMMEDIATE" | "SCHEDULED">(
    readiness.allowedKinds[0] ?? "SCHEDULED",
  );
  const [pickupAt, setPickupAt] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());
  const saved = useRef<{ key: string; body: string } | null>(null);
  const interaction = useRef(onInteractionState);
  interaction.current = onInteractionState;

  useEffect(() => {
    interaction.current?.(reviewing || pickupAt !== "" || unknown, pending || unknown);
  }, [reviewing, pickupAt, pending, unknown]);
  useEffect(() => () => interaction.current?.(false, false), []);

  useEffect(() => {
    if (saved.current) return;
    key.current = crypto.randomUUID();
    setPickupKind(readiness.allowedKinds[0] ?? "SCHEDULED");
    setPickupAt("");
    setReviewing(false);
    setMessage(null);
  }, [delivery.jobId, delivery.version, readiness.allowedKinds[0]]);

  async function book() {
    if (
      pending ||
      !readiness.allowedKinds.includes(pickupKind) ||
      (pickupKind === "SCHEDULED" && !pickupAt)
    )
      return;
    setPending(true);
    setMessage(null);
    const payload = {
      locationId,
      jobId: delivery.jobId,
      expectedVersion: delivery.version,
      providerCode: "lalamove" as const,
      pickup:
        pickupKind === "IMMEDIATE"
          ? ({ kind: "IMMEDIATE" } as const)
          : ({ kind: "SCHEDULED", pickupAt: new Date(pickupAt).toISOString() } as const),
    };
    const request = saved.current ?? { key: key.current, body: JSON.stringify(payload) };
    saved.current = request;
    try {
      const result = await readResult<ExternalDeliveryDispatchView>(
        await fetchImpl("/api/admin/external-deliveries", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "idempotency-key": request.key },
          body: request.body,
        }),
      );
      setReviewing(false);
      setUnknown(false);
      saved.current = null;
      if (result.ok) {
        if (
          !["OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED", "FAILED"].includes(result.value.status)
        ) {
          notifyCommandSuccess(
            result.value.status === "ACTIVE"
              ? "Lalamove booking confirmed"
              : "Lalamove booking request accepted",
            undefined,
            `lalamove-booking:${request.key}`,
          );
        }
        key.current = crypto.randomUUID();
        const cost =
          result.value.quoteAmountMinor === null || result.value.quoteCurrency === null
            ? ""
            : ` Courier cost: ${result.value.quoteCurrency} ${(result.value.quoteAmountMinor / 100).toFixed(2)}.`;
        onBooked(`Lalamove booking ${result.value.status.toLowerCase()}.${cost}`);
      } else {
        key.current = crypto.randomUUID();
        setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
      }
    } catch {
      setUnknown(true);
      setReviewing(false);
      setMessage("Booking outcome is unknown. Retry to safely reuse the same request key.");
    } finally {
      setPending(false);
    }
  }

  if (readiness.unavailableReason) return <p className="text-sm">{readiness.unavailableReason}</p>;
  return (
    <section className="space-y-3 rounded border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3">
      <div>
        <h3 className="font-semibold">
          {delivery.status === "FAILED" || delivery.status === "RETRY_SCHEDULED"
            ? "Retry courier"
            : "External courier"}
        </h3>
        <p className="text-xs text-[var(--fm-text-muted)]">
          {fulfillmentMode === "INSTANT"
            ? "Request the courier the customer chose at checkout."
            : "After packing, request a driver now or choose a future pickup within the customer’s delivery range."}
        </p>
      </div>
      {fulfillmentMode === "SCHEDULED" ? (
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Lalamove pickup</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`pickup-${delivery.jobId}`}
              checked={pickupKind === "IMMEDIATE"}
              disabled={
                disabled || pending || unknown || !readiness.allowedKinds.includes("IMMEDIATE")
              }
              onChange={() => setPickupKind("IMMEDIATE")}
            />
            Request a driver now
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`pickup-${delivery.jobId}`}
              checked={pickupKind === "SCHEDULED"}
              disabled={
                disabled || pending || unknown || !readiness.allowedKinds.includes("SCHEDULED")
              }
              onChange={() => setPickupKind("SCHEDULED")}
            />
            Schedule pickup
          </label>
          {pickupKind === "SCHEDULED" ? (
            <div>
              <Label htmlFor={`pickup-at-${delivery.jobId}`}>Pickup time</Label>
              <Input
                id={`pickup-at-${delivery.jobId}`}
                type="datetime-local"
                value={pickupAt}
                disabled={disabled || pending || unknown}
                onChange={(event) => setPickupAt(event.target.value)}
                className="mt-1"
              />
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {message ? <p className="text-xs text-[var(--fm-danger)]">{message}</p> : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={
          disabled ||
          pending ||
          (!unknown && !readiness.allowedKinds.includes(pickupKind)) ||
          (pickupKind === "SCHEDULED" && !pickupAt)
        }
        onClick={() => (unknown ? void book() : setReviewing(true))}
      >
        {unknown ? "Retry saved booking request" : "Review Lalamove booking"}
      </Button>
      <AlertDialog
        open={reviewing}
        onOpenChange={(open) => {
          if (!pending && !unknown) setReviewing(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Confirm Lalamove booking</AlertDialogTitle>
          <AlertDialogDescription>
            Book Lalamove to collect this order from the store.
            {pickupKind === "SCHEDULED" && pickupAt
              ? ` Pickup: ${new Date(pickupAt).toLocaleString("en-PH")}.`
              : " Pickup: as soon as possible."}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild disabled={pending}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={() => void book()}>
              {pending ? "Booking…" : "Confirm and book"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
