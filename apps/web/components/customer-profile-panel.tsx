"use client";
import { useRef, useState } from "react";
import type { CustomerProfileView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { authClient } from "../lib/auth/auth-client";
import {
  formatProfilePhone,
  formatPhoneInput,
  normalizeProfilePhone,
} from "../lib/auth/phone-format";

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      customerId: z.string(),
      accountPhone: z.string().nullable(),
      defaultAddressId: z.string().nullable(),
      preferredLanguage: z.string().nullable(),
      promotionalEmails: z.boolean(),
      version: z.number().int().positive(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function CustomerProfilePanel({ initial }: { initial: CustomerProfileView }) {
  const [profile, setProfile] = useState(initial);
  const [phone, setPhone] = useState(formatProfilePhone(initial.accountPhone ?? ""));
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [promotions, setPromotions] = useState(initial.promotionalEmails);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current) return;
    const normalizedPhone = phone.trim() ? normalizeProfilePhone(phone) : null;
    if (!pending.current && phone.trim() && !normalizedPhone) {
      setPhoneError("Enter a Philippine mobile number, such as +63 917 123 4567.");
      return;
    }
    setPhoneError(null);
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        accountPhone: normalizedPhone,
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
        setPhone(formatProfilePhone(result.value.accountPhone ?? ""));
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
          <label htmlFor="account-phone">Phone</label>
          <Input
            id="account-phone"
            type="tel"
            inputMode="tel"
            placeholder="+63 917 123 4567"
            autoComplete="tel"
            value={phone}
            onInput={(event) => {
              setPhone(formatPhoneInput(event.currentTarget.value));
              setPhoneError(null);
            }}
            onBlur={(event) => setPhone(formatProfilePhone(event.currentTarget.value))}
            maxLength={40}
            aria-invalid={!!phoneError}
            aria-describedby={
              phoneError ? "account-phone-help account-phone-error" : "account-phone-help"
            }
          />
          {phoneError && (
            <p id="account-phone-error" role="alert" className="text-sm text-red-700">
              {phoneError}
            </p>
          )}
          <p id="account-phone-help" className="text-sm">
            Used as the default phone for a new delivery address. Each address can use a different
            recipient phone.
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

/** Better Auth owns the account name and session; Customers never copies it. */
export function CustomerNamePanel() {
  const { data, isPending, refetch } = authClient.useSession();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!data?.user) return null;
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const next = (name ?? data.user.name).trim();
        if (!next || busy) return;
        setBusy(true);
        setMessage("");
        try {
          const result = await authClient.updateUser({ name: next });
          if (result.error) setMessage("Your name could not be saved. Please try again.");
          else {
            await refetch();
            setName(null);
            setMessage("Name saved.");
          }
        } catch {
          setMessage("Saving your name could not be confirmed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block" htmlFor="account-name">
        Your name
      </label>
      <Input
        id="account-name"
        autoComplete="name"
        required
        maxLength={100}
        value={name ?? data.user.name}
        disabled={busy || isPending}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="text-sm">Sign-in email: {data.user.email}</p>
      <Button type="submit" disabled={busy || isPending}>
        {busy ? "Saving name…" : "Save name"}
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
