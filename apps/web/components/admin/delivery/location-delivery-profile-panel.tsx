"use client";

import type { LocationDeliveryProfileView, RpcResult } from "@freshmarkets/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAdminContext } from "../../../app/admin/admin-context-provider";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { useAdminCommandIntent } from "../admin-command-state";
import { useAdminLocation } from "../use-admin-location";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const fields = [
  ["senderName", "Sender name", true],
  ["phoneE164", "Sender phone (+63…)", true],
  ["email", "Sender email", false],
  ["formattedAddress", "Full pickup address", true],
  ["addressLine1", "Address line 1", true],
  ["addressLine2", "Building / unit", false],
  ["barangay", "Barangay", false],
  ["city", "City", true],
  ["region", "Region / province", false],
  ["postalCode", "Postal code", false],
] as const;

async function readResult<T>(response: Response | Promise<Response>): Promise<RpcResult<T>> {
  return (await (await response).json()) as RpcResult<T>;
}

export function LocationDeliveryProfilePanel({ fetchImpl = fetch }: { fetchImpl?: FetchLike }) {
  const location = useAdminLocation();
  const admin = useAdminContext();
  const command = useAdminCommandIntent();
  const [view, setView] = useState<LocationDeliveryProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const canManage =
    admin.state.phase === "ready" && admin.state.context.capabilities.includes("delivery.manage");

  useEffect(() => {
    const locationId = location.locationId;
    const generation = ++loadGeneration.current;
    setView(null);
    setMessage(null);
    command.reset();
    if (!locationId) return;
    const controller = new AbortController();
    setLoading(true);
    void readResult<LocationDeliveryProfileView>(
      fetchImpl(
        `/api/admin/delivery-location-profile?locationId=${encodeURIComponent(locationId)}`,
        {
          credentials: "same-origin",
          signal: controller.signal,
        },
      ),
    )
      .then((result) => {
        if (generation !== loadGeneration.current) return;
        if (result.ok) setView(result.value);
        else setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
      })
      .catch((error) => {
        if (generation !== loadGeneration.current) return;
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setMessage("Store pickup profile could not be loaded.");
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false);
      });
    return () => {
      loadGeneration.current += 1;
      controller.abort();
    };
  }, [fetchImpl, location.locationId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !canManage || command.pending) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) => String(data.get(name) ?? "").trim() || null;
    const payload = {
      locationId: view.locationId,
      senderName: String(data.get("senderName") ?? ""),
      phoneE164: String(data.get("phoneE164") ?? ""),
      email: optional("email"),
      formattedAddress: String(data.get("formattedAddress") ?? ""),
      addressLine1: String(data.get("addressLine1") ?? ""),
      addressLine2: optional("addressLine2"),
      barangay: optional("barangay"),
      city: String(data.get("city") ?? ""),
      region: optional("region"),
      postalCode: optional("postalCode"),
      countryCode: String(data.get("countryCode") ?? "PH"),
      pickupInstructions: optional("pickupInstructions"),
      expectedVersion: view.profile?.version ?? 0,
    };
    setMessage(null);
    try {
      const result = await command.submit((idempotencyKey) =>
        readResult<LocationDeliveryProfileView>(
          fetchImpl("/api/admin/delivery-location-profile", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify(payload),
          }),
        ),
      );
      if (result.ok) {
        setView(result.value);
        setMessage("Store pickup profile saved.");
      } else {
        setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
      }
    } catch {
      setMessage("The save result is unknown. Retry to safely reuse the same request key.");
    }
  }

  if (!location.locationId) return null;
  return (
    <details className="rounded border border-[var(--fm-border)] bg-white p-4">
      <summary className="cursor-pointer font-semibold">Store courier pickup profile</summary>
      <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
        {location.label}. Coordinates come from the store location record; these fields identify the
        sender and pickup address sent to the courier.
      </p>
      {loading ? <p className="mt-3 text-sm">Loading pickup profile…</p> : null}
      {message ? (
        <Alert className="mt-3" variant={message.includes("saved") ? "info" : "warning"}>
          <AlertTitle>Pickup profile</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {view ? (
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          {fields.map(([name, label, required]) => (
            <div className={name === "formattedAddress" ? "sm:col-span-2" : ""} key={name}>
              <Label htmlFor={`delivery-profile-${name}`}>{label}</Label>
              <Input
                id={`delivery-profile-${name}`}
                name={name}
                type={name === "email" ? "email" : "text"}
                required={required}
                disabled={!canManage}
                defaultValue={view.profile?.[name] ?? ""}
                className="mt-1"
              />
            </div>
          ))}
          <div>
            <Label htmlFor="delivery-profile-country">Country code</Label>
            <Input
              id="delivery-profile-country"
              name="countryCode"
              required
              disabled={!canManage}
              maxLength={2}
              defaultValue={view.profile?.countryCode ?? "PH"}
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="delivery-profile-instructions">Pickup instructions</Label>
            <textarea
              id="delivery-profile-instructions"
              name="pickupInstructions"
              maxLength={1000}
              disabled={!canManage}
              defaultValue={view.profile?.pickupInstructions ?? ""}
              className="mt-1 min-h-24 w-full rounded border border-[var(--fm-border)] px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--fm-text-muted)]">
              Store coordinate: {view.coordinate.latitude}, {view.coordinate.longitude}
            </span>
            {canManage ? (
              <Button type="submit" disabled={command.pending}>
                {command.pending
                  ? "Saving…"
                  : view.profile
                    ? "Update pickup profile"
                    : "Save pickup profile"}
              </Button>
            ) : (
              <span className="text-xs text-[var(--fm-text-muted)]">Read-only access</span>
            )}
          </div>
        </form>
      ) : null}
    </details>
  );
}
