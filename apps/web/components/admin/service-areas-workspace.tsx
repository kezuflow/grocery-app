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
import { notifyCommandSuccess } from "./admin-feedback";
import { GoogleMap } from "../maps/google-map";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";

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
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [initialView] = useState(() => ({
    center: vertices[0] ?? { latitude: 10.32, longitude: 123.9 },
    zoom: 11,
  }));
  const selected = selectedPoint === null ? undefined : vertices[selectedPoint];
  const move = (point: Coordinate) => {
    if (!disabled && selectedPoint !== null)
      onChange(vertices.map((current, index) => (index === selectedPoint ? point : current)));
  };
  const add = (point: Coordinate) => {
    if (!disabled && vertices.length < 100) onChange([...vertices, point]);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 font-medium">Service area boundary</legend>
      <p className="text-sm text-muted-foreground">
        Click around the outside edge of the area to add points. Add at least three; the last point
        connects to the first. Select a numbered point to move it. Publish when the shaded area is
        correct.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={selected ? "outline" : "default"}
          onClick={() => setSelectedPoint(null)}
        >
          Add points
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || vertices.length === 0}
          onClick={() => {
            onChange(vertices.slice(0, -1));
            setSelectedPoint(null);
          }}
        >
          Undo last point
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || vertices.length === 0}
          onClick={() => {
            onChange([]);
            setSelectedPoint(null);
          }}
        >
          Clear boundary
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {selected
          ? `Moving point ${Number(selectedPoint) + 1}: drag its pin or click its new position. Choose Add points to continue drawing.`
          : `${vertices.length} of 100 points. ${vertices.length < 3 ? "Add at least 3 points to form an area." : "The shaded area is your draft coverage boundary."}`}
      </p>
      {browserApiKey && mapId ? (
        <GoogleMap
          browserApiKey={browserApiKey}
          mapId={mapId}
          initialView={initialView}
          ariaLabel="Service area boundary map"
          className="h-[480px]"
          scene={{
            points: vertices.flatMap((position, index) =>
              selected && index === selectedPoint
                ? []
                : [
                    {
                      id: String(index),
                      position,
                      label: String(index + 1),
                    },
                  ],
            ),
            draggablePin:
              selected && !disabled
                ? { position: selected, label: `Boundary point ${Number(selectedPoint) + 1}` }
                : undefined,
            lineStrings: vertices.length === 2 ? [{ id: "draft-edge", points: vertices }] : [],
            polygons:
              vertices.length >= 3 ? [{ id: "boundary", rings: [[...vertices, vertices[0]]] }] : [],
          }}
          onMapClick={selected ? move : add}
          onPinMove={move}
          onPointActivate={(id) => {
            if (!disabled) setSelectedPoint(Number(id));
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Map unavailable. Enter verified coordinates below.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Enter boundary coordinates manually
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
      </details>
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
              aria-label={`Move service area point ${index + 1}`}
              onClick={() => setSelectedPoint(index)}
            >
              Move
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove service area point ${index + 1}`}
              onClick={() => {
                onChange(vertices.filter((_, position) => position !== index));
                setSelectedPoint(null);
              }}
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
  const [draftBaseline, setDraftBaseline] = useState("");
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
  const dirty = draft !== null && JSON.stringify(draft) !== draftBaseline;
  useAdminScopeGuard(dirty, locked, () => setDraft(null));
  useAdminRouteGuard(dirty, locked);

  function openDraft(next: Draft | null) {
    if (locked || (dirty && !window.confirm("Discard unsaved service area changes?"))) return;
    intent.reset();
    setDraft(next);
    setDraftBaseline(next ? JSON.stringify(next) : "");
    setNotice("");
  }

  async function refresh(cursor?: string) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/serviceability${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      const parsed = listResult.parse(await response.json());
      if (parsed.ok) {
        setResult((previous) =>
          cursor && previous.ok
            ? {
                ...parsed,
                value: {
                  ...parsed.value,
                  areas: [...previous.value.areas, ...parsed.value.areas],
                },
              }
            : parsed,
        );
      } else setNotice(parsed.error.message);
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
        notifyCommandSuccess("Service area published");
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
      <div className="space-y-2">
        <Link
          aria-label="Locations"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
          href="/admin/locations"
        >
          ← Locations
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
                onClick={() => openDraft(newDraft(result.value.markets[0]?.marketId ?? ""))}
              >
                Add service area
              </Button>
            )}
          </div>
          <ol className="overflow-hidden rounded-xl border border-border bg-[var(--fm-admin-surface)] divide-y divide-border">
            {result.value.areas.map((area, index) => (
              <li
                key={area.serviceAreaId}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/40"
              >
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Service area {index + 1}
                  </p>
                  <h2 className="mt-1 font-semibold">{area.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {result.value.markets.find((market) => market.marketId === area.marketId)?.name}{" "}
                    · Published boundary
                  </p>
                </div>
                {result.value.canManage && (
                  <Button
                    variant="outline"
                    disabled={locked}
                    onClick={() =>
                      openDraft({ ...area, expectedVersion: area.version, reason: "" })
                    }
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
              className="space-y-5 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!serviceAreaDefinitionSchema.safeParse(draft).success || !draft.reason.trim()) {
                  setNotice("Complete the area name, boundary and reason.");
                  return;
                }
                void publish(draft);
              }}
            >
              <h2 className="text-lg font-semibold tracking-tight">
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
                  key={draft.expectedVersion > 0 ? draft.code : "new"}
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
                <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                  Publishing immediately supersedes unpaid checkout quotes in this market. Payments
                  already started and committed orders keep their saved terms.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Publish service area</Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked}
                    onClick={() => openDraft(null)}
                  >
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
          <section className="space-y-3 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5">
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
