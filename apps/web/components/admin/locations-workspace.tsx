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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { LocationAddressMap } from "./location-address-map";

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
}: {
  initial: RpcResult<AdminLocationsView>;
  browserApiKey?: string;
  mapId?: string;
}) {
  const [result, setResult] = useState(initial);
  const [editing, setEditing] = useState<AdminLocationView | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(() => draftFor());
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const intent = useAdminCommandIntent();
  const locked = intent.pending || pendingPayload !== null;
  async function load(cursor?: string) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/locations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setResult(listResult.parse(await response.json()));
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
        setEditing(undefined);
        setNotice("Location saved.");
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
        title="Locations"
        description="Set each fulfillment center's confirmed pickup address and exact map pin. Global service areas admit customer addresses, the closest active center fulfills them, and Lalamove confirms each delivery route."
      />
      {result.ok && (
        <Link
          href="/admin/locations/service-areas"
          className="mb-4 inline-flex text-sm font-medium underline"
        >
          Manage global service areas
        </Link>
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
          <div className="mb-4 flex gap-2">
            <Button disabled={!result.value.canManage || locked} onClick={() => edit(null)}>
              Add location
            </Button>
            <Button variant="outline" disabled={loading || locked} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          <ListPageSection title="Operating locations">
            <div className="divide-y">
              {result.value.items.length === 0 && <p className="p-4">No locations configured.</p>}
              {result.value.items.map((location) => (
                <div
                  key={location.locationId}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <h2 className="font-medium">{location.name}</h2>
                    <Link
                      href={`/admin/locations/${encodeURIComponent(location.locationId)}/schedule`}
                      className="text-sm underline"
                    >
                      Operating hours for {location.name}
                    </Link>
                    {location.purpose === "CUSTOMER_FULFILLMENT" && (
                      <Link
                        href={`/admin/locations/${encodeURIComponent(location.locationId)}/fulfillment`}
                        className="block text-sm underline"
                      >
                        Fulfillment readiness for {location.name}
                      </Link>
                    )}
                    <p className="text-sm">
                      {location.purpose === "CENTRAL_WAREHOUSE"
                        ? "Central warehouse"
                        : "Customer fulfillment"}{" "}
                      · {location.status} · {location.marketName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {location.address
                        ? `${location.address.addressLine1}, ${location.address.city}`
                        : "Address confirmation needed"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      Pickup pin · {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!result.value.canManage || locked}
                    onClick={() => edit(location)}
                  >
                    Review {location.name}
                  </Button>
                </div>
              ))}
            </div>
          </ListPageSection>
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
                className="space-y-4 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
                  <LocationAddressMap
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
                    onCandidate={(candidate) =>
                      setDraft({
                        ...draft,
                        address: {
                          ...candidate.components,
                          region: candidate.components.region ?? draft.address.region,
                        },
                        latitude: String(candidate.coordinate.latitude),
                        longitude: String(candidate.coordinate.longitude),
                        componentsSource: "TEMPORARY_GEOCODER",
                        confirmationSource: "GEOCODER",
                      })
                    }
                    onCoordinate={(point, source) =>
                      setDraft({
                        ...draft,
                        latitude: String(point.latitude),
                        longitude: String(point.longitude),
                        confirmationSource: source,
                      })
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
                <p className="text-sm text-muted-foreground">
                  Activation makes the site operational. Customer serviceability and courier pickup
                  readiness are configured separately.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={intent.pending}>
                    {pendingPayload
                      ? "Retry saved command"
                      : editing
                        ? "Save details"
                        : "Create inactive location"}
                  </Button>
                  {editing && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locked || !reason.trim()}
                      onClick={() =>
                        void submit({
                          action: editing.status === "active" ? "DEACTIVATE" : "ACTIVATE",
                          locationId: editing.locationId,
                          expectedVersion: editing.version,
                          reason,
                        })
                      }
                    >
                      {editing.status === "active" ? "Deactivate location" : "Activate location"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={locked}
                    onClick={() => setEditing(undefined)}
                  >
                    Close
                  </Button>
                </div>
              </form>
            </ListPageSection>
          )}
        </>
      )}
    </>
  );
}
