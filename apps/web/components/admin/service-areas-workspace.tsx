"use client";
import { useState } from "react";
import { PageHeader } from "./admin-shell";
import Link from "next/link";
import type {
  AdminServiceAreaView,
  AdminServiceabilityView,
  AdminServiceAreaDefinition,
  Coordinate,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  z,
  serviceAreaDefinitionSchema,
  adminServiceAreaViewSchema,
  adminServiceabilityViewSchema,
  adminServiceabilityPreviewSchema,
} from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { MapboxMap } from "../maps/mapbox-map";
import { useAdminCommandIntent } from "./admin-command-state";
const failed = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
});
const listResult = z.union([
  failed,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminServiceabilityViewSchema }),
]);
const publishResult = z.union([
  failed,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminServiceAreaViewSchema }),
]);
const previewResult = z.union([
  failed,
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminServiceabilityPreviewSchema }),
]);
type Draft = AdminServiceAreaDefinition & { expectedVersion: number; reason: string };
function newDraft(marketId: string): Draft {
  return {
    marketId,
    code: "",
    name: "",
    vertices: [],
    zones: [{ code: "", name: "", vertices: [], locationIds: [] }],
    expectedVersion: 0,
    reason: "",
  };
}

function BoundaryEditor({
  label,
  vertices,
  onChange,
  disabled,
  publicAccessToken,
}: {
  label: string;
  vertices: readonly Coordinate[];
  onChange: (vertices: readonly Coordinate[]) => void;
  disabled: boolean;
  publicAccessToken?: string;
}) {
  const [latitude, setLatitude] = useState(""),
    [longitude, setLongitude] = useState("");
  const add = (point: Coordinate) => {
    if (!disabled && vertices.length < 100) onChange([...vertices, point]);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 font-medium">{label}</legend>
      <p className="text-sm text-muted-foreground">
        Add boundary points in order by clicking the map or entering coordinates. The last point
        connects to the first.
      </p>
      {publicAccessToken ? (
        <MapboxMap
          publicAccessToken={publicAccessToken}
          initialView={{ center: { latitude: 10.32, longitude: 123.9 }, zoom: 11 }}
          ariaLabel={`${label} map`}
          className="h-64"
          scene={{
            points: vertices.map((position, index) => ({
              id: String(index),
              position,
              label: String(index + 1),
            })),
            polygons:
              vertices.length >= 3 ? [{ id: "boundary", rings: [[...vertices, vertices[0]]] }] : [],
          }}
          onMapClick={add}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Map unavailable. Enter verified boundary coordinates below.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Label className="grid gap-2">
          Latitude
          <Input
            aria-label={`${label} latitude`}
            type="number"
            step="any"
            min={-90}
            max={90}
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </Label>
        <Label className="grid gap-2">
          Longitude
          <Input
            aria-label={`${label} longitude`}
            type="number"
            step="any"
            min={-180}
            max={180}
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </Label>
        <Button
          type="button"
          variant="outline"
          className="self-end"
          disabled={disabled || vertices.length >= 100}
          onClick={() => {
            const point = { latitude: Number(latitude), longitude: Number(longitude) };
            if (
              latitude.trim() &&
              longitude.trim() &&
              Number.isFinite(point.latitude) &&
              Number.isFinite(point.longitude) &&
              Math.abs(point.latitude) <= 90 &&
              Math.abs(point.longitude) <= 180
            ) {
              add(point);
              setLatitude("");
              setLongitude("");
            }
          }}
        >
          Add boundary point
        </Button>
      </div>
      <ol className="space-y-1 text-sm">
        {vertices.map((point, index) => (
          <li key={index} className="flex items-center justify-between gap-2">
            <span>
              {index + 1}. {point.latitude}, {point.longitude}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${label} point ${index + 1}`}
              onClick={() => onChange(vertices.filter((_, position) => position !== index))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}

export function ServiceAreasWorkspace({
  initial,
  publicAccessToken,
}: {
  initial: RpcResult<AdminServiceabilityView>;
  publicAccessToken?: string;
}) {
  const [result, setResult] = useState(initial),
    [draft, setDraft] = useState<Draft | null>(null),
    [notice, setNotice] = useState("");
  const [pendingBody, setPendingBody] = useState<Draft | null>(null),
    [loading, setLoading] = useState(false);
  const [previewPoint, setPreviewPoint] = useState({
    marketId: initial.ok ? (initial.value.markets[0]?.marketId ?? "") : "",
    latitude: "",
    longitude: "",
  });
  const [preview, setPreview] = useState(""),
    [previewing, setPreviewing] = useState(false);
  const intent = useAdminCommandIntent();
  const locked = intent.pending || pendingBody !== null;
  async function refresh(kind?: "areas" | "locations") {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (kind === "areas" && result.ok && result.value.nextCursor)
        query.set("cursor", result.value.nextCursor);
      if (kind === "locations" && result.ok && result.value.locationsNextCursor)
        query.set("locationCursor", result.value.locationsNextCursor);
      const response = await fetch(`/api/admin/serviceability?${query}`);
      const parsed = listResult.parse(await response.json());
      setResult((previous) =>
        kind && parsed.ok && previous.ok
          ? {
              ...parsed,
              value: {
                ...previous.value,
                ...(kind === "areas"
                  ? {
                      areas: [...previous.value.areas, ...parsed.value.areas],
                      nextCursor: parsed.value.nextCursor,
                    }
                  : {
                      locations: [
                        ...new Map(
                          [...previous.value.locations, ...parsed.value.locations].map(
                            (location) => [location.locationId, location],
                          ),
                        ).values(),
                      ],
                      locationsNextCursor: parsed.value.locationsNextCursor,
                    }),
              },
            }
          : parsed,
      );
    } catch {
      setNotice("Unable to refresh service areas. Retry when connected.");
    } finally {
      setLoading(false);
    }
  }
  async function publish(body: Draft) {
    setPendingBody(body);
    setNotice("");
    try {
      const response = await intent.submit(async (key) => {
        const response = await fetch("/api/admin/serviceability", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify({ ...body, action: "PUBLISH" }),
        });
        return publishResult.parse(await response.json());
      });
      setPendingBody(null);
      if (response.ok) {
        setDraft(null);
        setNotice(
          "Service area published. Review Scheduled cycle participation for the new zones.",
        );
        await refresh();
      } else setNotice(response.error.message);
    } catch {
      setNotice(
        "The publication result is unknown. Retry the same publication to recover its result.",
      );
    }
  }
  function edit(area: AdminServiceAreaView) {
    intent.reset();
    setDraft({ ...area, expectedVersion: area.version, reason: "" });
    setNotice("");
  }
  function updatePreviewPoint(next: typeof previewPoint) {
    setPreviewPoint(next);
    setPreview("");
  }
  async function runPreview() {
    setPreviewing(true);
    setPreview("");
    try {
      const response = await fetch("/api/admin/serviceability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "PREVIEW",
          marketId: previewPoint.marketId,
          latitude: Number(previewPoint.latitude),
          longitude: Number(previewPoint.longitude),
        }),
      });
      const parsed = previewResult.parse(await response.json());
      setPreview(
        parsed.ok
          ? parsed.value.serviceable
            ? `${parsed.value.locationName} — ${parsed.value.zoneName}`
            : (parsed.value.reason ?? "Unavailable")
          : parsed.error.message,
      );
    } catch {
      setPreview("Preview unavailable. Retry when connected.");
    } finally {
      setPreviewing(false);
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm underline" href="/admin/locations">
          Locations
        </Link>
        <PageHeader
          title="Service areas"
          description="Publish delivery boundaries and eligible locations, then preview the current fulfillment promise."
        />
      </div>
      {notice && <p role="status">{notice}</p>}
      {!result.ok ? (
        <div role="alert">
          {result.error.message}
          <Button onClick={() => void refresh()} disabled={loading}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading || locked}>
              Refresh
            </Button>
            {result.value.canManage && (
              <Button
                disabled={locked}
                onClick={() => {
                  intent.reset();
                  setDraft(newDraft(result.value.markets[0]?.marketId ?? ""));
                }}
              >
                New service area
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.value.areas.map((area) => (
              <article key={area.serviceAreaId} className="rounded-lg border p-4">
                <h2 className="font-semibold">{area.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {result.value.markets.find((market) => market.marketId === area.marketId)?.name} ·
                  Version {area.version} · {area.zones.length} zones
                </p>
                {result.value.canManage && (
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={locked}
                    onClick={() => edit(area)}
                  >
                    Review {area.name}
                  </Button>
                )}
              </article>
            ))}
          </div>
          {result.value.nextCursor && (
            <Button
              variant="outline"
              disabled={loading || locked}
              onClick={() => void refresh("areas")}
            >
              Load more service areas
            </Button>
          )}
          {result.value.locationsNextCursor && (
            <Button
              variant="outline"
              disabled={loading || locked}
              onClick={() => void refresh("locations")}
            >
              Load more eligible locations
            </Button>
          )}
          {result.value.areas.length === 0 && <p>No service areas have been published.</p>}
          {draft && result.value.canManage && (
            <form
              className="space-y-4 rounded-xl border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!serviceAreaDefinitionSchema.safeParse(draft).success || !draft.reason.trim()) {
                  setNotice("Complete the area, zone boundaries, eligible locations and reason.");
                  return;
                }
                void publish(draft);
              }}
            >
              <h2 className="text-lg font-semibold">
                {draft.expectedVersion === 0 ? "New service area" : "Review service area"}
              </h2>
              <fieldset disabled={locked} className="space-y-4">
                <Label className="grid gap-2">
                  Market
                  <Select
                    value={draft.marketId}
                    disabled={locked || draft.expectedVersion > 0}
                    onValueChange={(marketId) =>
                      setDraft({
                        ...draft,
                        marketId,
                        zones: draft.zones.map((zone) => ({ ...zone, locationIds: [] })),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {result.value.markets.map((market) => (
                        <SelectItem key={market.marketId} value={market.marketId}>
                          {market.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label className="grid gap-2">
                    Area code
                    <Input
                      required
                      disabled={draft.expectedVersion > 0}
                      value={draft.code}
                      onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                    />
                  </Label>
                  <Label className="grid gap-2">
                    Area name
                    <Input
                      required
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Label>
                </div>
                <BoundaryEditor
                  label="Service area boundary"
                  vertices={draft.vertices}
                  onChange={(vertices) => setDraft({ ...draft, vertices })}
                  disabled={locked}
                  publicAccessToken={publicAccessToken}
                />
                {draft.zones.map((zone, index) => {
                  const update = (patch: Partial<typeof zone>) =>
                    setDraft({
                      ...draft,
                      zones: draft.zones.map((value, position) =>
                        position === index ? { ...value, ...patch } : value,
                      ),
                    });
                  return (
                    <section key={index} className="space-y-3 rounded-lg border p-3">
                      <h3 className="font-semibold">Delivery zone {index + 1}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Label className="grid gap-2">
                          Zone code
                          <Input
                            aria-label={`Zone ${index + 1} code`}
                            required
                            value={zone.code}
                            onChange={(event) => update({ code: event.target.value })}
                          />
                        </Label>
                        <Label className="grid gap-2">
                          Zone name
                          <Input
                            aria-label={`Zone ${index + 1} name`}
                            required
                            value={zone.name}
                            onChange={(event) => update({ name: event.target.value })}
                          />
                        </Label>
                      </div>
                      <BoundaryEditor
                        label={`Zone ${index + 1} boundary`}
                        vertices={zone.vertices}
                        onChange={(vertices) => update({ vertices })}
                        disabled={locked}
                        publicAccessToken={publicAccessToken}
                      />
                      <fieldset className="space-y-2">
                        <legend className="font-medium">Eligible locations</legend>
                        {result.value.locations
                          .filter((location) => location.marketId === draft.marketId)
                          .map((location) => (
                            <Label key={location.locationId} className="flex gap-2">
                              <Checkbox
                                disabled={
                                  location.unavailable &&
                                  !zone.locationIds.includes(location.locationId)
                                }
                                checked={zone.locationIds.includes(location.locationId)}
                                onCheckedChange={(checked) =>
                                  update({
                                    locationIds:
                                      checked === true
                                        ? [...zone.locationIds, location.locationId]
                                        : zone.locationIds.filter(
                                            (id) => id !== location.locationId,
                                          ),
                                  })
                                }
                              />
                              {location.name}
                              {location.unavailable ? " (inactive or unavailable)" : ""}
                            </Label>
                          ))}
                      </fieldset>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={draft.zones.length === 1}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            zones: draft.zones.filter((_, position) => position !== index),
                          })
                        }
                      >
                        Remove zone
                      </Button>
                    </section>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.zones.length >= 20}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      zones: [
                        ...draft.zones,
                        { code: "", name: "", vertices: [], locationIds: [] },
                      ],
                    })
                  }
                >
                  Add zone
                </Button>
                <Label className="grid gap-2">
                  Reason
                  <Input
                    required
                    maxLength={500}
                    value={draft.reason}
                    onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                  />
                </Label>
                <p className="text-sm text-muted-foreground">
                  Publishing replaces the active area and its zones for new checkout. Scheduled
                  cycle participation must be reviewed for the new zones.
                </p>
                <div className="flex gap-2">
                  <Button type="submit">Publish service area</Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
              {pendingBody && !intent.pending && (
                <Button type="button" onClick={() => void publish(pendingBody)}>
                  Retry same publication
                </Button>
              )}
            </form>
          )}
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="text-lg font-semibold">Preview a delivery address</h2>
            <p className="text-sm text-muted-foreground">
              Uses published boundaries and current mode readiness. Stock, prices and courier
              quotation are checked separately during checkout.
            </p>
            <Label className="grid gap-2">
              Preview market
              <Select
                disabled={previewing}
                value={previewPoint.marketId}
                onValueChange={(marketId) => updatePreviewPoint({ ...previewPoint, marketId })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {result.value.markets.map((market) => (
                    <SelectItem key={market.marketId} value={market.marketId}>
                      {market.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label className="grid gap-2">
                Preview latitude
                <Input
                  type="number"
                  step="any"
                  disabled={previewing}
                  value={previewPoint.latitude}
                  onChange={(event) =>
                    updatePreviewPoint({ ...previewPoint, latitude: event.target.value })
                  }
                />
              </Label>
              <Label className="grid gap-2">
                Preview longitude
                <Input
                  type="number"
                  step="any"
                  disabled={previewing}
                  value={previewPoint.longitude}
                  onChange={(event) =>
                    updatePreviewPoint({ ...previewPoint, longitude: event.target.value })
                  }
                />
              </Label>
            </div>
            <Button
              disabled={
                previewing || !previewPoint.latitude.trim() || !previewPoint.longitude.trim()
              }
              onClick={() => void runPreview()}
            >
              Preview routing
            </Button>
            {preview && <p role="status">{preview}</p>}
          </section>
        </>
      )}
    </div>
  );
}
