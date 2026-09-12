"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AdminServiceAreaDefinition,
  AdminServiceabilityView,
  Coordinate,
  RpcResult,
} from "@freshmarkets/contracts";
import { appErrorCodes } from "@freshmarkets/contracts";
import {
  adminServiceAreaViewSchema,
  adminServiceabilityPreviewSchema,
  adminServiceabilityViewSchema,
  serviceAreaDefinitionSchema,
  z,
} from "@freshmarkets/validation";
import { PageHeader } from "./admin-shell";
import { useAdminCommandIntent } from "./admin-command-state";
import { GoogleMap } from "../maps/google-map";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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
  return { marketId, code: "", name: "", vertices: [], expectedVersion: 0, reason: "" };
}

function BoundaryEditor({
  vertices,
  onChange,
  disabled,
  browserApiKey,
  mapId,
}: {
  vertices: readonly Coordinate[];
  onChange: (vertices: readonly Coordinate[]) => void;
  disabled: boolean;
  browserApiKey?: string;
  mapId?: string;
}) {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const add = (point: Coordinate) => {
    if (!disabled && vertices.length < 100) onChange([...vertices, point]);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 font-medium">Service area boundary</legend>
      <p className="text-sm text-muted-foreground">
        Click the map in boundary order. The final point automatically connects to the first.
      </p>
      {browserApiKey && mapId ? (
        <GoogleMap
          browserApiKey={browserApiKey}
          mapId={mapId}
          initialView={{ center: { latitude: 10.32, longitude: 123.9 }, zoom: 11 }}
          ariaLabel="Service area boundary map"
          className="h-80"
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
          Map unavailable. Enter verified coordinates below.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Label className="grid gap-2">
          Latitude
          <Input
            aria-label="Service area latitude"
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
            aria-label="Service area longitude"
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
          <li key={`${point.latitude}:${point.longitude}:${index}`} className="flex gap-3">
            <span className="grow">
              {index + 1}. {point.latitude}, {point.longitude}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove service area point ${index + 1}`}
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
  browserApiKey,
  mapId,
}: {
  initial: RpcResult<AdminServiceabilityView>;
  browserApiKey?: string;
  mapId?: string;
}) {
  const [result, setResult] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingBody, setPendingBody] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewPoint, setPreviewPoint] = useState({
    marketId: initial.ok ? (initial.value.markets[0]?.marketId ?? "") : "",
    latitude: "",
    longitude: "",
  });
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const intent = useAdminCommandIntent();
  const locked = intent.pending || pendingBody !== null;

  async function refresh(cursor?: string) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/serviceability${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const parsed = listResult.parse(await response.json());
      setResult((previous) =>
        cursor && parsed.ok && previous.ok
          ? {
              ...parsed,
              value: {
                ...parsed.value,
                areas: [...previous.value.areas, ...parsed.value.areas],
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
        const publication = await fetch("/api/admin/serviceability", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify({ ...body, action: "PUBLISH" }),
        });
        return publishResult.parse(await publication.json());
      });
      setPendingBody(null);
      if (response.ok) {
        setDraft(null);
        setNotice("Service area published. New address checks now use this boundary.");
        await refresh();
      } else setNotice(response.error.message);
    } catch {
      setNotice("The publication result is unknown. Retry the same publication to recover it.");
    }
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
            ? `${parsed.value.serviceAreaName}: fulfilled by ${parsed.value.locationName}`
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
          description="Set the global delivery boundaries that admit customer addresses. Fulfillment locations keep only pickup pins; the nearest ready location is selected after this check."
        />
      </div>
      {notice && <p role="status">{notice}</p>}
      {!result.ok ? (
        <div role="alert" className="space-y-3">
          <p>{result.error.message}</p>
          <Button onClick={() => void refresh()} disabled={loading}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading || locked}>
              Refresh
            </Button>
            {result.value.canManage && (
              <Button
                disabled={locked}
                onClick={() => {
                  intent.reset();
                  setDraft(newDraft(result.value.markets[0]?.marketId ?? ""));
                  setNotice("");
                }}
              >
                Add service area
              </Button>
            )}
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {result.value.areas.map((area, index) => (
              <li key={area.serviceAreaId} className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Service area {index + 1}</p>
                <h2 className="font-semibold">{area.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {result.value.markets.find((market) => market.marketId === area.marketId)?.name} ·
                  Version {area.version}
                </p>
                {result.value.canManage && (
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={locked}
                    onClick={() => {
                      intent.reset();
                      setDraft({ ...area, expectedVersion: area.version, reason: "" });
                      setNotice("");
                    }}
                  >
                    Edit {area.name}
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {result.value.nextCursor && (
            <Button
              variant="outline"
              disabled={loading || locked}
              onClick={() => void refresh(result.value.nextCursor ?? undefined)}
            >
              Load more service areas
            </Button>
          )}
          {result.value.areas.length === 0 && (
            <p>No service areas are active. Customer addresses cannot proceed to checkout.</p>
          )}
          {draft && result.value.canManage && (
            <form
              className="space-y-4 rounded-xl border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!serviceAreaDefinitionSchema.safeParse(draft).success || !draft.reason.trim()) {
                  setNotice("Complete the area name, boundary and reason.");
                  return;
                }
                void publish(draft);
              }}
            >
              <h2 className="text-lg font-semibold">
                {draft.expectedVersion === 0 ? "Add service area" : `Edit ${draft.name}`}
              </h2>
              <fieldset disabled={locked} className="space-y-4">
                <Label className="grid gap-2">
                  Market
                  <Select
                    value={draft.marketId}
                    disabled={locked || draft.expectedVersion > 0}
                    onValueChange={(marketId) => setDraft({ ...draft, marketId })}
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
                      placeholder="CEBU"
                      value={draft.code}
                      onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                    />
                  </Label>
                  <Label className="grid gap-2">
                    Area name
                    <Input
                      required
                      placeholder="Cebu"
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Label>
                </div>
                <BoundaryEditor
                  vertices={draft.vertices}
                  onChange={(vertices) => setDraft({ ...draft, vertices })}
                  disabled={locked}
                  browserApiKey={browserApiKey}
                  mapId={mapId}
                />
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
                  Publishing immediately supersedes unpaid checkout quotes in this market. Payments
                  already started and committed orders keep their saved terms.
                </p>
                <div className="flex flex-wrap gap-2">
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
            <h2 className="text-lg font-semibold">Preview a customer address pin</h2>
            <p className="text-sm text-muted-foreground">
              Checks the active global areas and current fulfillment readiness. Lalamove route
              availability and fee are still confirmed separately during checkout.
            </p>
            <Label className="grid gap-2">
              Market
              <Select
                disabled={previewing}
                value={previewPoint.marketId}
                onValueChange={(marketId) => setPreviewPoint({ ...previewPoint, marketId })}
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
                Latitude
                <Input
                  type="number"
                  step="any"
                  disabled={previewing}
                  value={previewPoint.latitude}
                  onChange={(event) =>
                    setPreviewPoint({ ...previewPoint, latitude: event.target.value })
                  }
                />
              </Label>
              <Label className="grid gap-2">
                Longitude
                <Input
                  type="number"
                  step="any"
                  disabled={previewing}
                  value={previewPoint.longitude}
                  onChange={(event) =>
                    setPreviewPoint({ ...previewPoint, longitude: event.target.value })
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
              Preview serviceability
            </Button>
            {preview && <p role="status">{preview}</p>}
          </section>
        </>
      )}
    </div>
  );
}
