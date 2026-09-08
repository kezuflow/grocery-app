"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "@freshmarkets/validation";
import { Button } from "./ui/button";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.object({ staffId: z.string().min(1) }) }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

export function InitialAdministratorPanel({ expectedVersion }: { expectedVersion: 0 }) {
  const command = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit() {
    if (inFlight.current || complete) return;
    command.current ??= { key: crypto.randomUUID(), body: JSON.stringify({ expectedVersion }) };
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": command.current.key },
        body: command.current.body,
      });
      const parsed = resultSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid setup response");
      if (parsed.data.ok) {
        setComplete(true);
        setMessage("Global administrator access is ready.");
      } else setMessage(parsed.data.error.message);
    } catch {
      setMessage("Setup could not be confirmed. Retry to check the same request.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-6">
      <h2 className="text-xl font-semibold">Create your Global access</h2>
      <p>Your verified account is configured to perform this installation’s first setup.</p>
      <p>
        This grants Global administration of staff access, customer operations, catalog and prices,
        locations, orders, inventory, fulfillment, delivery, payments and refunds, promotions,
        procurement, reporting and settings.
      </p>
      <p>
        Review staff roles after setup and invite each operator with the access and locations they
        need.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {complete ? (
        <Link className="underline" href="/admin">
          Open Admin
        </Link>
      ) : (
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Creating access…" : "Create Global administrator access"}
        </Button>
      )}
    </section>
  );
}
