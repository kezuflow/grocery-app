"use client";

import type { LocationDeliveryProfileView, AdminLocationView } from "@freshmarkets/contracts";
import Link from "next/link";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  z,
  locationDeliveryProfileViewSchema,
  adminLocationsViewSchema,
} from "@freshmarkets/validation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAdminContext } from "../../../app/admin/admin-context-provider";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { useAdminCommandIntent } from "../admin-command-state";
import { notifyCommandSuccess } from "../admin-feedback";
import { useSetupNavigationLock } from "../location-setup-state";
import { useAdminScopeGuard } from "../../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "../use-admin-route-guard";

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

const resultSchema = z.union([
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: locationDeliveryProfileViewSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);
async function readResult(response: Response | Promise<Response>) {
  return resultSchema.parse(await (await response).json());
}

export function LocationDeliveryProfilePanel({
  locationId,
  fetchImpl = fetch,
  reuseLocationAddress = false,
  onSaved,
}: {
  locationId: string;
  fetchImpl?: FetchLike;
  reuseLocationAddress?: boolean;
  onSaved?: () => void;
}) {
  const admin = useAdminContext();
  const command = useAdminCommandIntent();
  const [view, setView] = useState<LocationDeliveryProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [dirty, setDirty] = useState(false);
  const locked = pendingPayload !== null || command.pending;
  useAdminScopeGuard(dirty, locked, () => {
    setDirty(false);
    setRefreshVersion((version) => version + 1);
  });
  useAdminRouteGuard(dirty, locked);
  useSetupNavigationLock(pendingPayload !== null || command.pending);
  const loadGeneration = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [savedLocation, setSavedLocation] = useState<AdminLocationView | null>(null);
  const canManage =
    admin.state.phase === "ready" && admin.state.context.capabilities.includes("delivery.manage");

  useEffect(() => {
    const generation = ++loadGeneration.current;
    setView(null);
    setSavedLocation(null);
    setMessage(null);
    command.reset();
    if (!locationId) return;
    const controller = new AbortController();
    setLoading(true);
    void readResult(
      fetchImpl(
        `/api/admin/delivery-location-profile?locationId=${encodeURIComponent(locationId)}`,
        {
          credentials: "same-origin",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        },
      ),
    )
      .then(async (result) => {
        let location: AdminLocationView | null = null;
        if (result.ok && reuseLocationAddress) {
          const response = await fetchImpl(
            `/api/admin/locations?locationId=${encodeURIComponent(locationId)}`,
            {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            },
          );
          const parsed = z
            .object({ ok: z.literal(true), value: adminLocationsViewSchema })
            .safeParse(await response.json());
          if (!parsed.success) throw new Error("Location address unavailable");
          location = parsed.data.value.items.find((item) => item.locationId === locationId) ?? null;
        }
        if (generation !== loadGeneration.current) return;
        setSavedLocation(location);
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
  }, [fetchImpl, locationId, refreshVersion, reuseLocationAddress]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !canManage || command.pending) return;
    if (reuseLocationAddress && !savedLocation?.address) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) => String(data.get(name) ?? "").trim() || null;
    const payload = pendingPayload ?? {
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
      ...(reuseLocationAddress && savedLocation?.address
        ? {
            ...savedLocation.address,
            formattedAddress: [
              savedLocation.address.addressLine1,
              savedLocation.address.addressLine2,
              savedLocation.address.barangay,
              savedLocation.address.city,
              savedLocation.address.region,
              savedLocation.address.postalCode,
              savedLocation.address.countryCode,
            ]
              .filter(Boolean)
              .join(", "),
            expectedLocationVersion: savedLocation.version,
          }
        : {}),
    };
    await save(payload);
  }

  async function save(payload: Record<string, unknown>) {
    if (command.pending) return;
    setPendingPayload(payload);
    setMessage(null);
    try {
      const result = await command.submit((idempotencyKey) =>
        readResult(
          fetchImpl("/api/admin/delivery-location-profile", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000),
          }),
        ),
      );
      setPendingPayload(null);
      if (result.ok) {
        setView(result.value);
        setDirty(false);
        notifyCommandSuccess("Courier pickup details saved");
        if (onSaved) window.setTimeout(onSaved, 0);
      } else {
        setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
      }
    } catch {
      setMessage("Save not confirmed. Retry saving to confirm these pickup details.");
    }
  }

  return (
    <section className="rounded-xl border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5">
      <h1 className="text-xl font-semibold">{view?.locationName ?? "Location"} courier pickup</h1>
      <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
        Coordinates come from this location's saved pin; these fields identify the sender and pickup
        address sent to the courier.
      </p>
      {reuseLocationAddress && view && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <h2 className="font-medium">Pickup location from step 1</h2>
          <p>
            {savedLocation?.address
              ? [
                  savedLocation.address.addressLine1,
                  savedLocation.address.addressLine2,
                  savedLocation.address.barangay,
                  savedLocation.address.city,
                  savedLocation.address.region,
                ]
                  .filter(Boolean)
                  .join(", ")
              : "Save the location address and pin before completing pickup contact."}
          </p>
          <Link href={`/admin/locations/${encodeURIComponent(locationId)}`} className="underline">
            Edit address and map pin
          </Link>
        </div>
      )}
      {loading ? <p className="mt-3 text-sm">Loading pickup profile…</p> : null}
      {message ? (
        <Alert className="mt-3" variant="warning">
          <AlertTitle>Pickup profile</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        disabled={loading || command.pending || pendingPayload !== null}
        onClick={() => {
          if (dirty && !window.confirm("Discard unsaved pickup details and refresh?")) return;
          setDirty(false);
          setRefreshVersion((version) => version + 1);
        }}
      >
        {loading ? "Refreshing…" : "Refresh pickup details"}
      </Button>
      {view && (!reuseLocationAddress || savedLocation?.address) ? (
        <form
          key={`${view.locationId}:${view.profile?.version ?? 0}`}
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onInput={() => setDirty(true)}
          onSubmit={submit}
        >
          {(reuseLocationAddress ? fields.slice(0, 3) : fields).map(([name, label, required]) => (
            <div className={name === "formattedAddress" ? "sm:col-span-2" : ""} key={name}>
              <Label htmlFor={`delivery-profile-${name}`}>{label}</Label>
              <Input
                id={`delivery-profile-${name}`}
                name={name}
                type={name === "email" ? "email" : "text"}
                required={required}
                disabled={!canManage || command.pending || pendingPayload !== null}
                defaultValue={view.profile?.[name] ?? ""}
                className="mt-1"
              />
            </div>
          ))}
          {!reuseLocationAddress && (
            <div>
              <Label htmlFor="delivery-profile-country">Country code</Label>
              <Input
                id="delivery-profile-country"
                name="countryCode"
                required
                disabled={!canManage || command.pending || pendingPayload !== null}
                maxLength={2}
                defaultValue={view.profile?.countryCode ?? "PH"}
                className="mt-1"
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="delivery-profile-instructions">Pickup instructions</Label>
            <textarea
              id="delivery-profile-instructions"
              name="pickupInstructions"
              maxLength={1000}
              disabled={!canManage || command.pending || pendingPayload !== null}
              defaultValue={view.profile?.pickupInstructions ?? ""}
              className="mt-1 min-h-24 w-full rounded border border-[var(--fm-border)] px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--fm-text-muted)]">
              Store coordinate: {view.coordinate.latitude}, {view.coordinate.longitude}
            </span>
            {canManage ? (
              <Button
                type={pendingPayload ? "button" : "submit"}
                onClick={pendingPayload ? () => void save(pendingPayload) : undefined}
                disabled={command.pending}
              >
                {command.pending
                  ? "Saving…"
                  : pendingPayload
                    ? "Retry saving"
                    : onSaved
                      ? "Save and continue"
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
    </section>
  );
}
