"use client";
import type { CustomerInvitationOffer } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({ customerId: z.string().min(1), invitationId: z.string().min(1) }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function CustomerInvitationPanel({ offer }: { offer: CustomerInvitationOffer }) {
  const pending = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function accept() {
    if (inFlight.current || accepted) return;
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        invitationId: offer.invitationId,
        expectedVersion: offer.expectedVersion,
      }),
    };
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/customer-invitation", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.current.key },
        body: pending.current.body,
      });
      const parsed = resultSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid response");
      if (parsed.data.ok) {
        setAccepted(true);
        setMessage("Your customer account is ready.");
      } else setMessage(parsed.data.error.message);
    } catch {
      setMessage("Acceptance could not be confirmed. Retry with this same invitation.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-6">
      <h2 className="text-xl font-semibold">Welcome to FreshMarkets</h2>
      <p>
        Accept this invitation to set up your customer account. You can then save your delivery
        address and shop.
      </p>
      <p className="text-sm">Expires {new Date(offer.expiresAt).toLocaleString("en-PH")}</p>
      {message ? <p role="status">{message}</p> : null}
      {accepted ? (
        <Link className="underline" href="/account/addresses">
          Add your delivery address
        </Link>
      ) : (
        <Button disabled={busy} onClick={() => void accept()}>
          {busy ? "Accepting…" : "Accept customer invitation"}
        </Button>
      )}
    </section>
  );
}
