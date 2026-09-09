"use client";

import { useState } from "react";
import type { AdminDeliveryOperationView, ManualDeliveryAction } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

const labels: Record<ManualDeliveryAction, string> = {
  ASSIGN: "Assign manual delivery",
  HAND_OVER: "Hand over packed order",
  COMPLETE: "Record delivered",
  FAIL: "Record delivery failure",
};
const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

export function ManualDeliveryControls({
  item,
  onChanged,
}: {
  item: AdminDeliveryOperationView;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<ManualDeliveryAction | null>(null);
  const [personName, setName] = useState("");
  const [phoneE164, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const manual = item.manualDelivery;

  async function submit() {
    if (!action || pending) return;
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
          ? { personName, phoneE164, reason }
          : { dispatchId: manual?.dispatchId }),
        ...(action === "COMPLETE" || action === "FAIL" ? { actualCostMinor } : {}),
        ...(action === "FAIL" ? { reason } : {}),
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
        setSaved(null);
        setAction(null);
        setMessage("Manual delivery updated.");
        onChanged();
      } else {
        setSaved(null);
        setMessage(result.error.message);
      }
    } catch {
      setMessage("The result is unknown. Retry the saved request to check the same action.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 text-sm">
      {manual ? (
        <div>
          <p>
            Manual · {manual.personName} · {manual.phoneE164}
          </p>
          <p>{manual.reason}</p>
          <p>
            {manual.status}
            {manual.returnInspectedAt !== null
              ? " · Returned and inspected"
              : manual.handedOverAt !== null
                ? " · Handed over"
                : ""}
          </p>
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
              onClick={() => {
                setAction(next);
                setMessage(null);
                setReason("");
                setCost("");
              }}
            >
              {labels[next]}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={pending || saved !== null} className="space-y-2">
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
                {action === "ASSIGN" ? "Reason for manual delivery" : "What went wrong"}
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                  required
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
          <Button size="sm" type="submit" disabled={pending}>
            {pending ? "Saving…" : saved ? "Retry saved request" : labels[action]}
          </Button>
          {!saved ? (
            <Button size="sm" variant="ghost" type="button" onClick={() => setAction(null)}>
              Back
            </Button>
          ) : null}
        </form>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
