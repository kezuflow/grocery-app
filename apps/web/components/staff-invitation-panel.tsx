"use client";
import type { StaffInvitationOffer } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.object({ staffId: z.string().min(1) }) }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function StaffInvitationPanel({ offer }: { offer: StaffInvitationOffer }) {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function accept() {
    if (busy || accepted) return;
    key.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const response = await fetch("/api/staff-invitation", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ invitationId: offer.invitationId, expectedVersion: offer.version }),
      });
      const parsed = resultSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid response");
      if (parsed.data.ok) {
        setAccepted(true);
        setMessage("Staff access is ready.");
      } else setMessage(parsed.data.error.message);
    } catch {
      setMessage("Acceptance could not be confirmed. Retry with this same invitation.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-6">
      <h2 className="text-xl font-semibold">Welcome, {offer.displayName}</h2>
      <p>Review the access your administrator assigned before accepting.</p>
      <div>
        <h3 className="font-medium">Roles</h3>
        <ul>
          {offer.roles.map((role) => (
            <li key={role.roleId}>{role.name}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">Locations and scope</h3>
        <ul>
          {offer.scopes.map((scope, index) => (
            <li key={index}>{scope.label}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm">Expires {new Date(offer.expiresAt).toLocaleString("en-PH")}</p>
      {message ? <p role="status">{message}</p> : null}
      {accepted ? (
        <Link className="underline" href="/admin">
          Open Admin
        </Link>
      ) : (
        <Button
          disabled={busy || !offer.roles.length || !offer.scopes.length}
          onClick={() => void accept()}
        >
          {busy ? "Accepting…" : "Accept staff invitation"}
        </Button>
      )}
      {!offer.roles.length || !offer.scopes.length ? (
        <p>Ask your administrator to replace this invitation with explicit access grants.</p>
      ) : null}
    </section>
  );
}
