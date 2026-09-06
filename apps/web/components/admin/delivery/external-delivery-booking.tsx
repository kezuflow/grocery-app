"use client";

import type { ExternalDeliveryDispatchView, RpcResult } from "@freshmarkets/contracts";
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
  fetchImpl = fetch,
  onBooked,
}: {
  locationId: string;
  fulfillmentMode: FulfillmentMode;
  delivery: OrderedDeliveryItem;
  disabled: boolean;
  fetchImpl?: FetchLike;
  onBooked: (message: string) => void;
}) {
  const [pickupKind, setPickupKind] = useState<"IMMEDIATE" | "SCHEDULED">("IMMEDIATE");
  const [pickupAt, setPickupAt] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    key.current = crypto.randomUUID();
    setPickupKind("IMMEDIATE");
    setPickupAt("");
    setReviewing(false);
    setMessage(null);
  }, [delivery.jobId, delivery.version]);

  async function book() {
    if (pending || (pickupKind === "SCHEDULED" && !pickupAt)) return;
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
    try {
      const result = await readResult<ExternalDeliveryDispatchView>(
        await fetchImpl("/api/admin/external-deliveries", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "idempotency-key": key.current },
          body: JSON.stringify(payload),
        }),
      );
      setReviewing(false);
      if (result.ok) {
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
      setMessage("Booking outcome is unknown. Retry to safely reuse the same request key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded border border-[var(--fm-border)] bg-white p-3">
      <div>
        <h3 className="font-semibold">External courier</h3>
        <p className="text-xs text-[var(--fm-text-muted)]">
          {fulfillmentMode === "INSTANT"
            ? "Core enforces the delivery partner selected by the customer at checkout."
            : "Use Lalamove now or set a pickup time within the customer’s committed delivery window."}
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
              disabled={disabled || pending}
              onChange={() => setPickupKind("IMMEDIATE")}
            />
            Request a driver now
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`pickup-${delivery.jobId}`}
              checked={pickupKind === "SCHEDULED"}
              disabled={disabled || pending}
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
                disabled={disabled || pending}
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
        disabled={disabled || pending || (pickupKind === "SCHEDULED" && !pickupAt)}
        onClick={() => setReviewing(true)}
      >
        Review Lalamove booking
      </Button>
      <AlertDialog open={reviewing} onOpenChange={setReviewing}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm Lalamove booking</AlertDialogTitle>
          <AlertDialogDescription>
            This asks Lalamove to create a paid courier order from this store for delivery job{" "}
            {delivery.jobId}.
            {pickupKind === "SCHEDULED" && pickupAt
              ? ` Pickup: ${new Date(pickupAt).toLocaleString("en-PH")}.`
              : " Pickup: as soon as possible."}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
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
