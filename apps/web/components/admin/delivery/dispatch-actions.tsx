"use client";

import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { useRef, useState } from "react";
import { Button } from "../../ui/button";
import { ExternalDeliveryBooking } from "./external-delivery-booking";
import { ManualDeliveryControls } from "./manual-delivery-controls";

/** Core supplies both choices only for an eligible first dispatch or definite retry. */
export function DispatchActions({
  item,
  onBooked,
  onChanged,
  onInteractionState,
}: {
  item: AdminDeliveryOperationView;
  onBooked: (message: string) => void;
  onChanged: () => void;
  onInteractionState: (kind: "booking" | "manual", dirty: boolean, locked: boolean) => void;
}) {
  const [choice, setChoice] = useState<"courier" | "manual" | null>(null);
  const selected = useRef<"courier" | "manual" | null>(null);
  const [working, setWorking] = useState(false);
  const canBook = item.courierPickup.allowedKinds.length > 0;
  const canAssign = item.manualActions.includes("ASSIGN");
  const competing = canBook && canAssign;
  const showBooking = canBook && (!competing || choice === "courier");
  const showManual = !competing || choice === "manual";

  return (
    <div className="space-y-3">
      {competing ? (
        <section
          aria-label="Choose dispatch method"
          className="space-y-2 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3"
        >
          <h3 className="text-sm font-semibold">Choose dispatch method</h3>
          <p className="text-xs text-[var(--fm-text-muted)]">
            {item.fulfillmentMode === "SCHEDULED"
              ? "Packed Scheduled order: request Lalamove or assign a person for manual delivery."
              : "A definite courier attempt has closed. Choose the next permitted delivery method."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={choice === "courier" ? "default" : "outline"}
              disabled={working}
              aria-pressed={choice === "courier"}
              onClick={() => {
                selected.current = "courier";
                setWorking(false);
                setChoice("courier");
              }}
            >
              Request Lalamove
            </Button>
            <Button
              type="button"
              size="sm"
              variant={choice === "manual" ? "default" : "outline"}
              disabled={working}
              aria-pressed={choice === "manual"}
              onClick={() => {
                selected.current = "manual";
                setWorking(false);
                setChoice("manual");
              }}
            >
              Assign manual rider
            </Button>
          </div>
        </section>
      ) : null}
      {showBooking ? (
        <ExternalDeliveryBooking
          locationId={item.locationId}
          fulfillmentMode={item.fulfillmentMode}
          delivery={{ jobId: item.jobId, status: item.status, version: item.version }}
          disabled={false}
          readiness={item.courierPickup}
          onBooked={onBooked}
          onInteractionState={(dirty, locked) => {
            if (!competing || selected.current === "courier") setWorking(dirty || locked);
            onInteractionState("booking", dirty, locked);
          }}
        />
      ) : null}
      {showManual ? (
        <ManualDeliveryControls
          item={item}
          initialAction={competing ? "ASSIGN" : null}
          onChanged={onChanged}
          onInteractionState={(dirty, locked) => {
            if (!competing || selected.current === "manual") setWorking(dirty || locked);
            onInteractionState("manual", dirty, locked);
          }}
        />
      ) : null}
      {!canBook &&
      !item.externalDispatch &&
      !item.manualDelivery &&
      item.courierPickup.unavailableReason ? (
        <p className="text-sm text-[var(--fm-text-muted)]">
          {item.courierPickup.unavailableReason}
        </p>
      ) : null}
    </div>
  );
}
