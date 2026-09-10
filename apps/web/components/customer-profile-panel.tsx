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
  const { data, isPending, refetch } = authClient.useSession();
  const [name, setName] = useState<string | null>(null);
  const [profile, setProfile] = useState(initial);
  const [phone, setPhone] = useState(formatProfilePhone(initial.accountPhone ?? ""));
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [promotions, setPromotions] = useState(initial.promotionalEmails);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<{ key: string; body: string; name: string; nameSaved: boolean } | null>(
    null,
  );
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current || !data?.user) return;
    const nextName = (name ?? data.user.name).trim();
    if (!nextName) {
      setMessage("Enter your name.");
      return;
    }
    const normalizedPhone = phone.trim() ? normalizeProfilePhone(phone) : null;
    if (!pending.current && phone.trim() && !normalizedPhone) {
      setPhoneError("Enter a Philippine mobile number, such as +63 917 123 4567.");
      return;
    }
    setPhoneError(null);
    pending.current ??= {
      key: crypto.randomUUID(),
      name: nextName,
      nameSaved: nextName === data.user.name,
      body: JSON.stringify({
        accountPhone: normalizedPhone,
        // Preserve the stored language: it is still required by the update contract.
        preferredLanguage: profile.preferredLanguage,
        promotionalEmails: promotions,
        expectedVersion: profile.version,
      }),
    };
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (!pending.current.nameSaved) {
        const nameResult = await authClient.updateUser({ name: pending.current.name });
        if (nameResult.error) {
          pending.current = null;
          setUncertain(false);
          setMessage("Your name could not be saved. No phone or preference changes were saved.");
          return;
        }
        pending.current.nameSaved = true;
        setName(pending.current.name);
      }
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
        await refetch();
        setMessage("Account details saved.");
      } else
        setMessage(
          `Your name is saved. Phone and preferences were not saved: ${result.error.message}`,
        );
      pending.current = null;
      setUncertain(false);
    } catch {
      setUncertain(true);
      setMessage("Saving all account details could not be confirmed. Retry to finish saving.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (isPending) return <p role="status">Loading account details…</p>;
  if (!data?.user)
    return <p role="status">Account details could not be loaded. Refresh to try again.</p>;
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={busy || uncertain} className="fm-profile-fields">
        <div className="space-y-2">
          <label htmlFor="account-name">Name</label>
          <Input
            id="account-name"
            autoComplete="name"
            required
            maxLength={100}
            value={name ?? data.user.name}
            disabled={busy || isPending}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="account-phone">Phone Number</label>
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
        <div className="space-y-2">
          <label htmlFor="account-email" className="block">
            Email
          </label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            value={data.user.email}
            readOnly
            aria-readonly="true"
          />
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
        {busy ? "Saving…" : uncertain ? "Retry saving" : "Save"}
      </Button>
    </form>
  );
}
