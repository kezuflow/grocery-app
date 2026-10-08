"use client";

import type {
  AdminDeliveryOperationView,
  RpcResult,
  SharedDeliveryBookingView,
} from "@freshmarkets/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../shadcn/alert";
import { Button } from "../shadcn/button";
import { Checkbox } from "../shadcn/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../shadcn/field";
import { Input } from "../shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../shadcn/sheet";
import { Textarea } from "../shadcn/textarea";
import { notifyCommandSuccess } from "../admin-feedback";

type SavedRequest = { key: string; body: string };
export function SharedDeliveryBooking({
  locationId,
  selected,
  open,
  onClose,
  onChanged,
  onInteractionState,
}: {
  locationId: string;
  selected: readonly Pick<AdminDeliveryOperationView, "jobId" | "version" | "courierPickup">[];
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onInteractionState: (dirty: boolean, locked: boolean) => void;
}) {
  const [pickupKind, setPickupKind] = useState("IMMEDIATE");
  const [pickupAt, setPickupAt] = useState("");
  const [optimize, setOptimize] = useState(false);
  const [lateReason, setLateReason] = useState("");
  const [fits, setFits] = useState(false);
  const [review, setReview] = useState<SharedDeliveryBookingView | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [expired, setExpired] = useState(false);
  const savedReview = useRef<SavedRequest | null>(null);
  const savedConfirm = useRef<SavedRequest | null>(null);
  const pendingRef = useRef(false);
  const interaction = useRef(onInteractionState);
  interaction.current = onInteractionState;
  const needsLateReason = selected.some(
    (item) =>
      item.courierPickup.isLate ||
      (!!item.courierPickup.deadlineAt &&
        (Date.parse(item.courierPickup.deadlineAt) <= Date.now() ||
          (pickupKind === "SCHEDULED" &&
            Date.parse(pickupAt) > Date.parse(item.courierPickup.deadlineAt)))),
  );
  useEffect(() => {
    interaction.current(open, pending || unknown);
  }, [open, pending, unknown]);
  useEffect(() => () => interaction.current(false, false), []);
  useEffect(() => {
    const update = () => setExpired(!!review && Date.parse(review.expiresAt) <= Date.now() + 15000);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [review]);

  function close() {
    if (pendingRef.current) return;
    setReview(null);
    setFits(false);
    setMessage(null);
    setUnknown(false);
    savedReview.current = null;
    savedConfirm.current = null;
    onClose();
  }
  async function prepare() {
    if (
      pendingRef.current ||
      selected.length < 2 ||
      selected.length > 5 ||
      (needsLateReason && !lateReason.trim()) ||
      (pickupKind === "SCHEDULED" &&
        (!pickupAt || !Number.isFinite(Date.parse(pickupAt)) || Date.parse(pickupAt) <= Date.now()))
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setMessage(null);
    const request = savedReview.current ?? {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        locationId,
        jobs: selected.map((item) => ({ jobId: item.jobId, expectedVersion: item.version })),
        optimize,
        pickup:
          pickupKind === "IMMEDIATE"
            ? { kind: "IMMEDIATE" }
            : { kind: "SCHEDULED", pickupAt: new Date(pickupAt).toISOString() },
        ...(lateReason.trim() ? { lateDispatchReason: lateReason.trim() } : {}),
      }),
    };
    savedReview.current = request;
    try {
      const response = await fetch("/api/admin/shared-deliveries", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": request.key },
        body: request.body,
      });
      const result = (await response.json()) as RpcResult<SharedDeliveryBookingView>;
      savedReview.current = null;
      setUnknown(false);
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setReview(result.value);
      setFits(false);
    } catch {
      setUnknown(true);
      setMessage("The quote response was lost. Retry the saved review to recover it.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function confirm() {
    if (pendingRef.current || !review || (!savedConfirm.current && (!fits || expired))) return;
    pendingRef.current = true;
    setPending(true);
    setMessage(null);
    const request = savedConfirm.current ?? {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        locationId,
        bookingId: review.bookingId,
        expectedVersion: review.version,
        combinedLoadFits: true,
      }),
    };
    savedConfirm.current = request;
    try {
      const response = await fetch("/api/admin/shared-deliveries/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": request.key },
        body: request.body,
      });
      const result = (await response.json()) as RpcResult<SharedDeliveryBookingView>;
      savedConfirm.current = null;
      setUnknown(false);
      if (!result.ok) {
        setMessage(result.error.message);
        setReview(null);
        setFits(false);
        onChanged();
        return;
      }
      notifyCommandSuccess(
        "Shared Lalamove booking confirmed",
        undefined,
        `shared-booking:${request.key}`,
      );
      pendingRef.current = false;
      close();
      onChanged();
    } catch {
      setUnknown(true);
      setMessage(
        "Booking outcome is unknown. Retry the saved confirmation or check the Delivery queue before booking again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent
        className="fm-admin flex w-full flex-col sm:max-w-lg"
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>Book one rider</SheetTitle>
          <SheetDescription>
            {selected.length} packed Scheduled Orders · one pickup · up to five drop-offs
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
          {message ? (
            <Alert>
              <AlertTitle>Booking update</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {!review ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="shared-pickup">Rider pickup</FieldLabel>
                <Select
                  value={pickupKind}
                  onValueChange={setPickupKind}
                  disabled={pending || unknown}
                >
                  <SelectTrigger id="shared-pickup">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="fm-admin">
                    <SelectGroup>
                      <SelectItem value="IMMEDIATE">Request a driver now</SelectItem>
                      <SelectItem value="SCHEDULED">Choose a future pickup</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {pickupKind === "SCHEDULED" ? (
                <Field>
                  <FieldLabel htmlFor="shared-pickup-at">Pickup date and time</FieldLabel>
                  <Input
                    id="shared-pickup-at"
                    type="datetime-local"
                    value={pickupAt}
                    onChange={(event) => setPickupAt(event.target.value)}
                    disabled={pending || unknown}
                  />
                </Field>
              ) : null}
              <Field orientation="horizontal">
                <Checkbox
                  id="shared-optimize"
                  checked={optimize}
                  onCheckedChange={(value) => setOptimize(value === true)}
                  disabled={pending || unknown}
                />
                <FieldLabel htmlFor="shared-optimize">
                  Let Lalamove optimize the drop-off order
                </FieldLabel>
              </Field>
              {needsLateReason ? (
                <Field>
                  <FieldLabel htmlFor="shared-late-reason">Reason for late dispatch</FieldLabel>
                  <Textarea
                    id="shared-late-reason"
                    value={lateReason}
                    maxLength={1000}
                    onChange={(event) => setLateReason(event.target.value)}
                    disabled={pending || unknown}
                  />
                  <FieldDescription>
                    Required when a selected Order or pickup is past its delivery window.
                  </FieldDescription>
                </Field>
              ) : null}
            </FieldGroup>
          ) : (
            <>
              <div>
                <p className="font-medium">One pickup</p>
                <p className="text-sm text-muted-foreground">
                  {review.pickup.kind === "IMMEDIATE"
                    ? "Request a driver now"
                    : new Date(review.pickup.pickupAt).toLocaleString("en-PH")}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <p className="font-medium">
                  {review.optimized ? "Optimized drop-offs" : "Drop-off order"}
                </p>
                <ol className="flex flex-col gap-4">
                  {review.stops.map((stop) => (
                    <li key={stop.jobId} className="flex gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm">
                        {stop.position}
                      </span>
                      <div>
                        <p className="text-sm font-medium">
                          {stop.recipientName} · Order {stop.orderNumber}
                        </p>
                        <p className="text-sm text-muted-foreground">{stop.destinationLabel}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Combined courier quote</p>
                <p className="text-2xl font-semibold">
                  PHP {(review.quoteAmountMinor / 100).toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground">
                  One total for this shared booking. Customer delivery charges stay unchanged.
                </p>
                <p className="text-xs text-muted-foreground">
                  {expired
                    ? "Quote expired. Request a new review."
                    : `Quote expires ${new Date(review.expiresAt).toLocaleTimeString("en-PH")}.`}
                </p>
              </div>
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="shared-fits"
                    checked={fits}
                    onCheckedChange={(value) => setFits(value === true)}
                    disabled={pending || unknown}
                  />
                  <div>
                    <FieldLabel htmlFor="shared-fits">
                      All Orders fit together on one Motorcycle
                    </FieldLabel>
                    <FieldDescription>
                      Verify the combined load is at most 20 kg and fits 0.5 × 0.4 × 0.5 m. Check
                      the actual packed goods.
                    </FieldDescription>
                  </div>
                </Field>
              </FieldGroup>
            </>
          )}
        </div>
        <SheetFooter>
          {review ? (
            <Button
              onClick={() => void confirm()}
              disabled={pending || (!savedConfirm.current && (!fits || expired))}
            >
              {pending
                ? "Booking…"
                : savedConfirm.current
                  ? "Retry saved confirmation"
                  : "Confirm shared booking"}
            </Button>
          ) : (
            <Button
              onClick={() => void prepare()}
              disabled={
                pending ||
                selected.length < 2 ||
                selected.length > 5 ||
                (needsLateReason && !lateReason.trim()) ||
                (pickupKind === "SCHEDULED" && !pickupAt)
              }
            >
              {pending
                ? "Getting quote…"
                : savedReview.current
                  ? "Retry saved review"
                  : "Get combined quote"}
            </Button>
          )}
          {review && !unknown ? (
            <Button
              variant="outline"
              onClick={() => {
                setReview(null);
                setFits(false);
              }}
              disabled={pending}
            >
              Change pickup or request a new quote
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              close();
              if (unknown) onChanged();
            }}
            disabled={pending}
          >
            {unknown ? "Check Delivery queue" : "Close"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
