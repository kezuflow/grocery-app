"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminDeliveryOperationView, ManualDeliveryAction } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "@/components/admin/shadcn/button";
import { Input } from "@/components/admin/shadcn/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/admin/shadcn/alert-dialog";
import { notifyCommandSuccess } from "../admin-feedback";

const labels: Record<ManualDeliveryAction, string> = {
  ASSIGN: "Assign and hand over order",
  HAND_OVER: "Hand over packed order",
  COMPLETE: "Record delivered",
  FAIL: "Record delivery failure",
};
const successTitles: Record<ManualDeliveryAction, string> = {
  ASSIGN: "Manual delivery out for delivery",
  HAND_OVER: "Order handed over",
  COMPLETE: "Manual delivery completed",
  FAIL: "Manual delivery failure recorded",
};
const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

export function ManualDeliveryControls({
  item,
  onChanged,
  onInteractionState,
  initialAction = null,
  disabled = false,
  onDismiss,
  onRejected,
}: {
  item: AdminDeliveryOperationView;
  onChanged: () => void;
  onInteractionState?: (dirty: boolean, locked: boolean) => void;
  initialAction?: ManualDeliveryAction | null;
  disabled?: boolean;
  onDismiss?: () => void;
  onRejected?: (message: string) => void;
}) {
  const [action, setAction] = useState<ManualDeliveryAction | null>(initialAction);
  const [reviewing, setReviewing] = useState(false);
  const [personName, setName] = useState("");
  const [phoneE164, setPhone] = useState("");
  const [noteOrReason, setNoteOrReason] = useState("");
  const [cost, setCost] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const manual = item.manualDelivery;
  const interaction = useRef(onInteractionState);
  interaction.current = onInteractionState;
  useEffect(() => {
    const draft =
      action !== null &&
      (action !== "ASSIGN" ||
        initialAction !== "ASSIGN" ||
        personName !== "" ||
        phoneE164 !== "" ||
        noteOrReason !== "" ||
        cost !== "");
    interaction.current?.(draft || reviewing, pending || saved !== null);
  }, [action, initialAction, personName, phoneE164, noteOrReason, cost, reviewing, pending, saved]);
  useEffect(() => () => interaction.current?.(false, false), []);

  async function submit() {
    if (!action || pending || disabled) return;
    setReviewing(false);
    const actualCostMinor = cost.trim() === "" ? null : Math.round(Number(cost) * 100);
    if (
      !saved &&
      cost.trim() !== "" &&
      (!/^\d+(\.\d{1,2})?$/.test(cost) || !Number.isSafeInteger(actualCostMinor))
    ) {
      setMessage(
        "Enter a non-negative cost with at most two decimal places, or leave it blank when unknown.",
      );
      return;
    }
    const request = saved ?? {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        locationId: item.locationId,
        jobId: item.jobId,
        action,
        expectedVersion: action === "ASSIGN" ? item.version : manual?.version,
        ...(action === "ASSIGN"
          ? {
              personName,
              phoneE164,
              ...(noteOrReason.trim() ? { note: noteOrReason.trim() } : {}),
            }
          : { dispatchId: manual?.dispatchId }),
        ...(action === "COMPLETE" || action === "FAIL" ? { actualCostMinor } : {}),
        ...(action === "FAIL" ? { reason: noteOrReason } : {}),
      }),
    };
    setSaved(request);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/manual-deliveries", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.key },
        body: request.body,
      });
      const result = responseSchema.parse(await response.json());
      if (result.ok) {
        notifyCommandSuccess(successTitles[action], undefined, `manual-delivery:${request.key}`);
        setSaved(null);
        setAction(null);
        setMessage("Manual delivery updated.");
        onChanged();
      } else {
        setSaved(null);
        setMessage(result.error.message);
        onRejected?.(result.error.message);
      }
    } catch {
      setMessage("The result is unknown. Retry the saved request to check the same action.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {manual ? (
        <div>
          <p>
            Manual · {manual.personName} · {manual.phoneE164}
          </p>
          <p>
            Selection reason:{" "}
            {manual.selectionReason === "STAFF_SELECTED_MANUAL"
              ? "Staff chose manual delivery"
              : manual.selectionReason.toLowerCase().replaceAll("_", " ")}
          </p>
          {manual.note ? <p>{manual.note}</p> : null}
          <p>Result: {manual.status.toLowerCase().replaceAll("_", " ")}</p>
          {manual.handedOverAt !== null ? (
            <p>Handed over: {new Date(manual.handedOverAt).toLocaleString("en-PH")}</p>
          ) : null}
          {manual.returnInspectedAt !== null ? <p>Returned and inspected</p> : null}
          {manual.status !== "ACTIVE" ? (
            <p>
              Actual cost:{" "}
              {manual.actualCostMinor === null
                ? "Unknown"
                : `${manual.currency ?? ""} ${(manual.actualCostMinor / 100).toFixed(2)}`}
            </p>
          ) : null}
        </div>
      ) : null}
      {!action ? (
        <div className="flex flex-wrap gap-2">
          {item.manualActions.map((next) => (
            <Button
              key={next}
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setAction(next);
                setMessage(null);
                setNoteOrReason("");
                setCost("");
              }}
            >
              {labels[next]}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            if (saved) void submit();
            else if (
              cost.trim() !== "" &&
              (!/^\d+(\.\d{1,2})?$/.test(cost) ||
                !Number.isSafeInteger(Math.round(Number(cost) * 100)))
            ) {
              setMessage(
                "Enter a non-negative cost with at most two decimal places, or leave it blank when unknown.",
              );
            } else {
              setMessage(null);
              setReviewing(true);
            }
          }}
        >
          <fieldset
            disabled={disabled || pending || saved !== null}
            className="flex flex-col gap-2"
          >
            <legend>{labels[action]}</legend>
            {action === "ASSIGN" ? (
              <>
                <label className="block">
                  Person delivering
                  <Input
                    value={personName}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                  />
                </label>
                <label className="block">
                  Phone including country code
                  <Input
                    type="tel"
                    value={phoneE164}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+639171234567"
                    pattern="\+[1-9][0-9]{7,14}"
                    required
                  />
                </label>
              </>
            ) : null}
            {action === "ASSIGN" || action === "FAIL" ? (
              <label className="block">
                {action === "ASSIGN" ? "Operational note (optional)" : "What went wrong"}
                <Input
                  value={noteOrReason}
                  onChange={(e) => setNoteOrReason(e.target.value)}
                  maxLength={1000}
                  required={action === "FAIL"}
                />
              </label>
            ) : null}
            {action === "COMPLETE" || action === "FAIL" ? (
              <label className="block">
                Actual delivery cost ({manual?.currency ?? "PHP"})
                <Input
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Leave blank if unknown"
                />
              </label>
            ) : null}
          </fieldset>
          <Button size="sm" type="submit" disabled={disabled || pending}>
            {pending
              ? "Saving…"
              : saved
                ? "Retry saved request"
                : `Review ${labels[action].toLowerCase()}`}
          </Button>
          {!saved ? (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={disabled || pending}
              onClick={() => {
                setAction(null);
                onDismiss?.();
              }}
            >
              Back
            </Button>
          ) : null}
        </form>
      )}
      {message ? <p role="status">{message}</p> : null}
      <AlertDialog open={reviewing} onOpenChange={(open) => !pending && setReviewing(open)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            Confirm {action ? labels[action].toLowerCase() : "manual delivery"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action === "ASSIGN"
              ? `Confirm that this packed order is being handed to ${personName} (${phoneE164}) now. The customer status will become Out for delivery.`
              : action === "HAND_OVER"
                ? "Record that the packed order has physically been handed to the assigned person."
                : action === "COMPLETE"
                  ? `Record delivery as completed. Actual delivery cost: ${cost.trim() || "unknown"} ${manual?.currency ?? "PHP"}.`
                  : `Record delivery as failed. Actual delivery cost: ${cost.trim() || "unknown"} ${manual?.currency ?? "PHP"}.`}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild disabled={pending}>
              <Button type="button" variant="outline">
                Back
              </Button>
            </AlertDialogCancel>
            <Button type="button" disabled={disabled || pending} onClick={() => void submit()}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
