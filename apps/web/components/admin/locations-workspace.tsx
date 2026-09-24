"use client";
import { useState } from "react";
import Link from "next/link";
import type {
  AdminLocationView,
  AdminLocationsView,
  LocationCapability,
  LocationAddress,
  LocationPurpose,
  RpcResult,
  AddressComponentsSource,
  CoordinateConfirmationSource,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  z,
  adminLocationsViewSchema,
  adminLocationViewSchema,
  adminLocationDetailsSchema,
  locationCapabilitySchema,
} from "@freshmarkets/validation";
import { PageHeader, ListPageSection } from "./admin-shell";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { LocationAddressMap } from "./location-address-map";
import { useSetupNavigationLock } from "./location-setup-state";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";
import { AdminStatusPill } from "./admin-status-pill";

const failed = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const listResult = z.union([
  failed,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminLocationsViewSchema }),
]);
const commandResult = z.union([
  failed,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminLocationViewSchema }),
]);
const blankAddress = {
  addressLine1: "",
  addressLine2: null,
  barangay: null,
  city: "",
  region: "",
  postalCode: null,
  countryCode: "PH",
};
type Draft = {
  componentsSource: AddressComponentsSource;
  confirmationSource: CoordinateConfirmationSource;
  name: string;
  code: string;
  marketId: string;
  purpose: LocationPurpose;
  latitude: string;
  longitude: string;
  address: LocationAddress;
  capabilities: LocationCapability[];
};
function draftFor(location?: AdminLocationView): Draft {
  return {
    componentsSource: location?.address ? "SAVED_ADDRESS" : "FIRST_PARTY",
    confirmationSource: "USER_PIN",
    name: location?.name ?? "",
    code: location?.code ?? "",
    marketId: location?.marketId ?? "",
    purpose: location?.purpose ?? "CUSTOMER_FULFILLMENT",
    latitude: location ? String(location.latitude) : "",
    longitude: location ? String(location.longitude) : "",
    address: { ...(location?.address ?? blankAddress) },
    capabilities: [...(location?.capabilities ?? [])],
  };
}

export function LocationsWorkspace({
  initial,
  browserApiKey,
  mapId,
  detailLocationId,
  onSaved,
  saveLabel,
}: {
  initial: RpcResult<AdminLocationsView>;
  browserApiKey?: string;
  mapId?: string;
  detailLocationId?: string;
  onSaved?: (location: AdminLocationView) => void;
  saveLabel?: string;
}) {
  const [result, setResult] = useState(initial);
  const selected = initial.ok
    ? initial.value.items.find((item) => item.locationId === detailLocationId)
    : undefined;
  const [editing, setEditing] = useState<AdminLocationView | null | undefined>(selected);
  const [draft, setDraft] = useState<Draft>(() => draftFor(selected));
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const intent = useAdminCommandIntent();
  const locked = intent.pending || pendingPayload !== null;
  const dirty =
    editing !== undefined &&
    (reason.trim().length > 0 ||
      JSON.stringify(draft) !== JSON.stringify(draftFor(editing ?? undefined)));
  useAdminScopeGuard(dirty, locked, () => {
    if (editing === null) setEditing(undefined);
    else if (editing) edit(editing);
  });
  useAdminRouteGuard(dirty, locked);
  useSetupNavigationLock(locked);
  async function load(cursor?: string, resetEditor = false) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/locations${detailLocationId ? `?locationId=${encodeURIComponent(detailLocationId)}` : cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const next = listResult.parse(await response.json());
      if (next.ok) {
        setResult(next);
        if (resetEditor && detailLocationId && next.value.items[0]) edit(next.value.items[0]);
      } else setNotice(next.error.message);
    } catch {
      setNotice("Locations could not be loaded. Retry to refresh.");
    } finally {
      setLoading(false);
    }
  }
  function edit(location: AdminLocationView | null) {
    setEditing(location);
    setDraft(draftFor(location ?? undefined));
    setReason("");
    setNotice(null);
  }
  async function submit(payload: Record<string, unknown>) {
    setPendingPayload(payload);
    setNotice(null);
    try {
      const response = await intent.submit(async (key) => {
        const response = await fetch("/api/admin/locations", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify(payload),
        });
        return commandResult.parse(await response.json());
      });
      setPendingPayload(null);
      if (response.ok) {
        notifyCommandSuccess(payload.action === "CREATE" ? "Location created" : "Location saved");
        if (detailLocationId) edit(response.value);
        else setEditing(undefined);
        setNotice("Location saved.");
        if (onSaved && (payload.action === "UPDATE" || payload.action === "CREATE")) {
          // Let the draft/command guards settle before the next setup step navigates.
          window.setTimeout(() => onSaved(response.value), 0);
          return;
        }
        await load();
      } else {
        setNotice(response.error.message);
        await load();
      }
    } catch {
      setNotice("The outcome is unknown. Retry this exact command to recover its result.");
    }
  }
  function save() {
    if (pendingPayload) {
      void submit(pendingPayload);
      return;
    }
    const parsed = adminLocationDetailsSchema.safeParse({
      ...draft,
      latitude: draft.latitude.trim() ? Number(draft.latitude) : NaN,
      longitude: draft.longitude.trim() ? Number(draft.longitude) : NaN,
    });
    if (!parsed.success || !reason.trim()) {
      setNotice("Set the pickup pin and complete the address, capabilities and reason.");
      return;
    }
    void submit(
      editing
        ? {
            action: "UPDATE",
            ...parsed.data,
            locationId: editing.locationId,
            expectedVersion: editing.version,
            reason,
          }
        : {
            action: "CREATE",
            ...parsed.data,
            marketId: draft.marketId,
            code: draft.code,
            purpose: draft.purpose,
            reason,
          },
    );
  }
  return (
    <>
      <PageHeader
        title={detailLocationId ? `${editing?.name ?? "Location"} address and pin` : "Locations"}
        description="Set each fulfillment center's confirmed pickup address and exact map pin. Global service areas admit customer addresses, the closest active center fulfills them, and Lalamove confirms each delivery route."
      />
      {result.ok && !detailLocationId && (
        <div className="mb-5 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="font-semibold">Delivery coverage</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Service areas apply globally. Each location keeps its own pickup address and pin.
            </p>
          </div>
          <Link
            href="/admin/locations/service-areas"
            className="mt-3 inline-flex text-sm font-semibold underline-offset-4 hover:underline sm:mt-0"
          >
            Manage global service areas →
          </Link>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm">
          {notice}
        </p>
      )}
      {!result.ok ? (
        <div role="alert">
          <p>{result.error.message}</p>
          <Button disabled={loading} onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {!detailLocationId && (
              <Button disabled={!result.value.canManage || locked} onClick={() => edit(null)}>
                Add location
              </Button>
            )}
            <Button
              variant="outline"
              disabled={loading || locked}
              onClick={() => {
                if (dirty && !window.confirm("Discard unsaved location changes and refresh?"))
                  return;
                if (!detailLocationId) setEditing(undefined);
                void load(undefined, true);
              }}
            >
              Refresh
            </Button>
          </div>
          {detailLocationId && !editing && <p role="alert">Location not found.</p>}
          {!detailLocationId && (
            <ListPageSection title="Operating locations">
              <div className="divide-y divide-border">
                {result.value.items.length === 0 && <p className="p-4">No locations configured.</p>}
                {result.value.items.map((location) => (
                  <div
                    key={location.locationId}
                    className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-muted/40"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{location.name}</h2>
                        <AdminStatusPill
                          status={location.status}
                          tone={location.status === "active" ? "success" : "neutral"}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {location.purpose === "CENTRAL_WAREHOUSE"
                          ? "Central warehouse"
                          : "Customer fulfillment"}{" "}
                        · {location.marketName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {location.address
                          ? `${location.address.addressLine1}, ${location.address.city}`
                          : "Address confirmation needed"}
                      </p>
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Pickup pin coordinates</summary>
                        <span className="font-mono">
                          {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                        </span>
                      </details>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Link
                        href={`/admin/locations/${encodeURIComponent(location.locationId)}/schedule`}
                        aria-label={`Instant operating hours for ${location.name}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        Instant hours
                      </Link>
                      {location.purpose === "CUSTOMER_FULFILLMENT" && (
                        <Link
                          href={`/admin/locations/${encodeURIComponent(location.locationId)}/fulfillment`}
                          aria-label={`Fulfillment readiness for ${location.name}`}
                          className="text-sm font-medium underline-offset-4 hover:underline"
                        >
                          Fulfillment
                        </Link>
                      )}
                      <Link
                        aria-label={`Review setup for ${location.name}`}
                        className="text-sm font-semibold underline-offset-4 hover:underline"
                        href={`/admin/locations/${encodeURIComponent(location.locationId)}`}
                      >
                        Review setup →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </ListPageSection>
          )}
          {result.value.nextCursor && (
            <Button
              variant="outline"
              disabled={loading || locked}
              onClick={() => void load(result.value.nextCursor ?? undefined)}
            >
              Next locations
            </Button>
          )}
          {editing !== undefined && (
            <ListPageSection title={editing ? `Review ${editing.name}` : "New location"}>
              <form
                className="space-y-5 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <fieldset
                  disabled={locked || !result.value.canManage}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <LocationAddressMap
                    key={editing?.locationId ?? "new-location"}
                    browserApiKey={browserApiKey}
                    mapId={mapId}
                    disabled={locked}
                    coordinate={
                      draft.latitude.trim() &&
                      draft.longitude.trim() &&
                      Number.isFinite(Number(draft.latitude)) &&
                      Number.isFinite(Number(draft.longitude)) &&
                      Math.abs(Number(draft.latitude)) <= 90 &&
                      Math.abs(Number(draft.longitude)) <= 180
                        ? { latitude: Number(draft.latitude), longitude: Number(draft.longitude) }
                        : null
                    }
                    onCandidate={(candidate, source) =>
                      setDraft((current) => {
                        // A lookup must not overwrite manual address edits or a newer pin.
                        if (
                          current.address !== draft.address ||
                          (source &&
                            (Number(current.latitude) !== candidate.coordinate.latitude ||
                              Number(current.longitude) !== candidate.coordinate.longitude))
                        )
                          return current;
                        return {
                          ...current,
                          address: {
                            ...candidate.components,
                            region: candidate.components.region ?? current.address.region,
                          },
                          latitude: String(candidate.coordinate.latitude),
                          longitude: String(candidate.coordinate.longitude),
                          componentsSource: "TEMPORARY_GEOCODER",
                          confirmationSource: source ?? "GEOCODER",
                        };
                      })
                    }
                    onCoordinate={(point, source) =>
                      setDraft((current) => ({
                        ...current,
                        latitude: String(point.latitude),
                        longitude: String(point.longitude),
                        confirmationSource: source,
                      }))
                    }
                  />
                  <div>
                    <Label htmlFor="location-name">Location name</Label>
                    <Input
                      id="location-name"
                      required
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="location-code">Location code</Label>
                    <Input
                      id="location-code"
                      required
                      disabled={Boolean(editing)}
                      pattern="[a-z0-9][a-z0-9-]*"
                      value={draft.code}
                      onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Market</Label>
                    <Select
                      disabled={Boolean(editing)}
                      value={draft.marketId}
                      onValueChange={(marketId) => setDraft({ ...draft, marketId })}
                    >
                      <SelectTrigger aria-label="Market">
                        <SelectValue placeholder="Select market" />
                      </SelectTrigger>
                      <SelectContent>
                        {result.value.markets.map((market) => (
                          <SelectItem key={market.marketId} value={market.marketId}>
                            {market.name} · {market.currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Purpose</Label>
                    <Select
                      disabled={Boolean(editing)}
                      value={draft.purpose}
                      onValueChange={(purpose) =>
                        setDraft({
                          ...draft,
                          purpose:
                            purpose === "CENTRAL_WAREHOUSE"
                              ? "CENTRAL_WAREHOUSE"
                              : "CUSTOMER_FULFILLMENT",
                          capabilities: [],
                        })
                      }
                    >
                      <SelectTrigger aria-label="Purpose">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOMER_FULFILLMENT">
                          Customer fulfillment site
                        </SelectItem>
                        <SelectItem value="CENTRAL_WAREHOUSE">Central warehouse</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(
                    [
                      "addressLine1",
                      "addressLine2",
                      "barangay",
                      "city",
                      "region",
                      "postalCode",
                      "countryCode",
                    ] as const
                  ).map((field, index) => (
                    <div key={field}>
                      <Label htmlFor={`location-${field}`}>
                        {
                          [
                            "Address line 1",
                            "Address line 2",
                            "Barangay",
                            "City",
                            "Region",
                            "Postal code",
                            "Country code",
                          ][index]
                        }
                      </Label>
                      <Input
                        id={`location-${field}`}
                        required={["addressLine1", "city", "region", "countryCode"].includes(field)}
                        value={draft.address[field] ?? ""}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            componentsSource:
                              draft.componentsSource === "TEMPORARY_GEOCODER" ||
                              editing?.addressProviderDerived
                                ? "TEMPORARY_GEOCODER"
                                : "FIRST_PARTY",
                            address: { ...draft.address, [field]: event.target.value || null },
                          })
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <Label htmlFor="location-latitude">Pickup pin latitude</Label>
                    <Input
                      id="location-latitude"
                      required
                      inputMode="decimal"
                      value={draft.latitude}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          latitude: event.target.value,
                          confirmationSource: "USER_PIN",
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="location-longitude">Pickup pin longitude</Label>
                    <Input
                      id="location-longitude"
                      required
                      inputMode="decimal"
                      value={draft.longitude}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          longitude: event.target.value,
                          confirmationSource: "USER_PIN",
                        })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-sm font-medium">Operating capabilities</p>
                    <div className="flex flex-wrap gap-4">
                      {locationCapabilitySchema.options
                        .filter(
                          (cap) =>
                            draft.purpose !== "CENTRAL_WAREHOUSE" ||
                            cap === "RECEIVING" ||
                            cap === "INVENTORY",
                        )
                        .map((cap) => (
                          <Label key={cap} className="flex items-center gap-2">
                            <Checkbox
                              checked={draft.capabilities.includes(cap)}
                              onCheckedChange={(checked) =>
                                setDraft({
                                  ...draft,
                                  capabilities:
                                    checked === true
                                      ? [...draft.capabilities, cap]
                                      : draft.capabilities.filter((value) => value !== cap),
                                })
                              }
                            />
                            {cap === "INVENTORY" ? "storage" : cap.toLowerCase()}
                          </Label>
                        ))}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="location-reason">Reason for this change</Label>
                    <Input
                      id="location-reason"
                      required
                      maxLength={500}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                </fieldset>
                <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                  Save these details to continue setup. Activation and dispatch readiness are
                  separate actions on the final review step.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={intent.pending || !result.value.canManage}>
                    {pendingPayload
                      ? "Retry saved command"
                      : editing
                        ? (saveLabel ?? "Save details")
                        : saveLabel
                          ? "Create and continue"
                          : "Create inactive location"}
                  </Button>
                  {!detailLocationId && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setEditing(undefined)}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </form>
            </ListPageSection>
          )}
        </>
      )}
    </>
  );
}
