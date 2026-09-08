"use client";
import { useRef, useState } from "react";
import type { CustomerProfileView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      customerId: z.string(),
      preferredLanguage: z.string().nullable(),
      promotionalEmails: z.boolean(),
      version: z.number().int().positive(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function CustomerProfilePanel({ initial }: { initial: CustomerProfileView }) {
  const [profile, setProfile] = useState(initial);
  const [language, setLanguage] = useState(initial.preferredLanguage ?? "");
  const [promotions, setPromotions] = useState(initial.promotionalEmails);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current) return;
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        preferredLanguage: language.trim() || null,
        promotionalEmails: promotions,
        expectedVersion: profile.version,
      }),
    };
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/commerce/profile", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.current.key },
        body: pending.current.body,
      });
      const result = resultSchema.parse(await response.json());
      if (result.ok) {
        setProfile(result.value);
        setLanguage(result.value.preferredLanguage ?? "");
        setPromotions(result.value.promotionalEmails);
        setMessage("Preferences saved.");
      } else setMessage(result.error.message);
      pending.current = null;
      setUncertain(false);
    } catch {
      setUncertain(true);
      setMessage("Saving could not be confirmed. Retry the same preferences.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={busy || uncertain} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="preferred-language">Preferred language</label>
          <Input
            id="preferred-language"
            maxLength={80}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            aria-describedby="language-help"
          />
          <p id="language-help" className="text-sm">
            Tell our support team your preferred language, such as English or Cebuano. This does not
            change the website language.
          </p>
        </div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={promotions}
            onChange={(event) => setPromotions(event.target.checked)}
            className="mt-1 size-4"
          />
          <span>Receive promotional emails</span>
        </label>
      </fieldset>
      <p className="text-sm">
        Order, payment, delivery, cancellation and refund updates are always sent.
      </p>
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : uncertain ? "Retry saving preferences" : "Save preferences"}
      </Button>
      {!uncertain ? (
        <a className="ml-4 underline" href="/account/profile">
          Reload preferences
        </a>
      ) : null}
    </form>
  );
}
