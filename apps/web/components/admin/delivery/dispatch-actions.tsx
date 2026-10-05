"use client";

import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/shadcn/alert";
import { Button } from "@/components/admin/shadcn/button";
import { Badge } from "@/components/admin/shadcn/badge";
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
      {item.courierPickup.isLate ? (
        <Alert>
          <AlertTitle>
            <Badge variant="destructive">Late</Badge> Scheduled delivery window passed
          </AlertTitle>
          <AlertDescription>
            Continue delivery with a recorded reason after packing. The original customer promise
            stays on the order.
          </AlertDescription>
        </Alert>
      ) : null}
      {competing ? (
        <section
          aria-label="Choose dispatch method"
          className="space-y-2 rounded-lg border border-border bg-card p-3"
        >
          <h3 className="text-sm font-semibold">Choose dispatch method</h3>
          <p className="text-xs text-muted-foreground">
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
      !canAssign &&
      ["UNASSIGNED", "RETRY_SCHEDULED", "FAILED"].includes(item.status) &&
      item.courierPickup.unavailableReason ? (
        <Alert>
          <AlertTitle>Lalamove pickup unavailable</AlertTitle>
          <AlertDescription>{item.courierPickup.unavailableReason}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
