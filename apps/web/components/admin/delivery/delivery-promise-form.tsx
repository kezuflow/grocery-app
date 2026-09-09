"use client";

import { useState } from "react";
import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function DeliveryPromiseForm({
  item,
  onChanged,
}: {
  item: AdminDeliveryOperationView;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!item.canRevisePromise) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const timestamp = Date.parse(time);
    if (!saved && (!Number.isFinite(timestamp) || !note.trim())) {
      setMessage("Enter the agreed time and a short agreement note.");
      return;
    }
    const request = saved ?? {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        locationId: item.locationId,
        jobId: item.jobId,
        expectedVersion: item.version,
        promisedAt: new Date(timestamp).toISOString(),
        agreementNote: note,
      }),
    };
    setSaved(request);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/delivery-promises", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.key },
        body: request.body,
      });
      const result = responseSchema.parse(await response.json());
      setSaved(null);
      if (result.ok) {
        setOpen(false);
        setMessage("Agreed delivery time saved.");
        onChanged();
      } else setMessage(result.error.message);
    } catch {
      setMessage("The result is unknown. Retry to check the same saved agreement.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      {!open ? (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Record agreed delivery time
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded border p-3">
          <p className="text-sm">
            Contact the customer first. This records their agreement and keeps the original promise
            and paid amount.
          </p>
          <label className="block text-sm">
            Deliver by (your local time)
            <Input
              type="datetime-local"
              required
              value={time}
              disabled={pending || saved !== null}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Customer agreement
            <Input
              required
              maxLength={1000}
              placeholder="For example: customer agreed by phone to delivery by 6 pm."
              value={note}
              disabled={pending || saved !== null}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : saved ? "Check saved agreement" : "Save agreed time"}
          </Button>
          {!saved && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          )}
        </form>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
