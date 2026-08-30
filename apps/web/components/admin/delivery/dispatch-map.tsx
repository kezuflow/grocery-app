"use client";

import {
  deliveryJobStates,
  type BatchRoutePreview,
  type DeliveryBatchView,
  type DeliveryMapDetail,
  type DeliveryMapPin,
  type DeliveryMapView,
  type EligibleRiderView,
  type FulfillmentMode,
  type RpcResult,
} from "@freshmarkets/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pinsInsideBounds } from "../../../lib/maps/delivery-selection";
import type { MapAdapter, MapCoordinate, MapScene } from "../../maps/map-types";
import { MapboxMap } from "../../maps/mapbox-map";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { FilterBar, ListPageSection, PageHeader, StatusBadge } from "../admin-shell";
import { useAdminCommandIntent } from "../admin-command-state";
import { AdminLiveRegion, AdminPageState } from "../admin-page-state";
import { useAdminLocation } from "../use-admin-location";
import { SelectedDeliveriesDrawer } from "./selected-deliveries-drawer";
import type { OrderedDeliveryItem } from "./delivery-order-list";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LoadState =
  | { phase: "idle" | "loading" }
  | { phase: "permission"; message: string; requestId?: string }
  | { phase: "error"; message: string; requestId?: string }
  | { phase: "ready" };

const CEBU_CENTER = { longitude: 123.8854, latitude: 10.3157 } as const;

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["DELIVERED"].includes(status)) return "success";
  if (["FAILED", "CANCELED", "ESCALATED"].includes(status)) return "danger";
  if (["RETRY_SCHEDULED"].includes(status)) return "warning";
  if (["ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(status)) return "info";
  return "neutral";
}

function pointTone(pin: DeliveryMapPin): "available" | "retry" | "assigned" | "blocked" {
  if (!pin.selection.selectable) return "blocked";
  if (["FAILED", "RETRY_SCHEDULED", "ESCALATED"].includes(pin.status)) return "retry";
  if (pin.rider || ["ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(pin.status)) return "assigned";
  return "available";
}

function contextQuery(locationId: string, mode: FulfillmentMode, cycleId: string): URLSearchParams {
  const query = new URLSearchParams({ locationId, fulfillmentMode: mode });
  if (mode === "SCHEDULED") query.set("cycleId", cycleId);
  return query;
}

async function readResult<T>(response: Response): Promise<RpcResult<T>> {
  return (await response.json()) as RpcResult<T>;
}

export function DispatchMap({
  publicAccessToken,
  mapAdapter,
  fetchImpl = fetch,
}: {
  publicAccessToken?: string;
  mapAdapter?: MapAdapter;
  fetchImpl?: FetchLike;
}) {
  const location = useAdminLocation();
  const commandIntent = useAdminCommandIntent();
  const [mode, setMode] = useState<FulfillmentMode>("INSTANT");
  const [cycleId, setCycleId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [riderFilter, setRiderFilter] = useState("");
  const [view, setView] = useState<DeliveryMapView | null>(null);
  const [riders, setRiders] = useState<ReadonlyArray<EligibleRiderView>>([]);
  const [state, setState] = useState<LoadState>({ phase: "idle" });
  const [selected, setSelected] = useState<ReadonlyArray<OrderedDeliveryItem>>([]);
  const [riderId, setRiderId] = useState("");
  const [detail, setDetail] = useState<DeliveryMapDetail | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchRoutePreview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [areaSelectionActive, setAreaSelectionActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const activeLoadAbort = useRef<AbortController | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const contextIdentity = `${location.locationId ?? ""}|${mode}|${
    mode === "SCHEDULED" ? cycleId.trim() : ""
  }`;
  const contextIdentityRef = useRef(contextIdentity);
  contextIdentityRef.current = contextIdentity;

  const clearIntent = useCallback(() => {
    setSelected([]);
    setRiderId("");
    setDetail(null);
    setDetailJobId(null);
    setPreview(null);
    setReviewing(false);
    setAreaSelectionActive(false);
  }, []);

  const loadWorkspace = useCallback(async () => {
    const locationId = location.locationId;
    const scheduledCycle = cycleId.trim();
    const generation = ++loadGeneration.current;
    activeLoadAbort.current?.abort();
    commandIntent.reset();
    detailGeneration.current += 1;
    clearIntent();
    setView(null);
    setRiders([]);
    if (!locationId || (mode === "SCHEDULED" && !scheduledCycle)) {
      setState({ phase: "idle" });
      return;
    }
    const controller = new AbortController();
    activeLoadAbort.current = controller;
    setState({ phase: "loading" });
    const query = contextQuery(locationId, mode, scheduledCycle);
    if (statusFilter) query.append("statuses", statusFilter);
    if (riderFilter) query.set("riderId", riderFilter);
    const riderQuery = contextQuery(locationId, mode, scheduledCycle);
    try {
      const [mapResponse, riderResponse] = await Promise.all([
        fetchImpl(`/api/admin/delivery-map?${query}`, {
          credentials: "same-origin",
          signal: controller.signal,
        }),
        fetchImpl(`/api/admin/delivery-batches?${riderQuery}`, {
          credentials: "same-origin",
          signal: controller.signal,
        }),
      ]);
      const [mapResult, riderResult] = await Promise.all([
        readResult<DeliveryMapView>(mapResponse),
        readResult<ReadonlyArray<EligibleRiderView>>(riderResponse),
      ]);
      if (generation !== loadGeneration.current) return;
      if (!mapResult.ok || !riderResult.ok) {
        const error = !mapResult.ok ? mapResult.error : !riderResult.ok ? riderResult.error : null;
        if (!error) return;
        setState(
          error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED"
            ? { phase: "permission", message: error.message, requestId: error.requestId }
            : { phase: "error", message: error.message, requestId: error.requestId },
        );
        return;
      }
      setView(mapResult.value);
      setRiders(riderResult.value);
      setState({ phase: "ready" });
    } catch (error) {
      if (
        generation !== loadGeneration.current ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      setState({ phase: "error", message: "Network access to the dispatch workspace failed." });
    }
  }, [
    clearIntent,
    commandIntent,
    cycleId,
    fetchImpl,
    location.locationId,
    mode,
    riderFilter,
    statusFilter,
  ]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      loadGeneration.current += 1;
      activeLoadAbort.current?.abort();
    };
  }, [loadWorkspace]);

  function invalidatePreview() {
    setPreview(null);
    setReviewing(false);
  }

  function togglePin(pin: DeliveryMapPin) {
    if (!pin.selection.selectable) {
      setMessage(pin.selection.reason ?? "This delivery is not selectable.");
      return;
    }
    setSelected((current) => {
      if (current.some((item) => item.jobId === pin.jobId)) {
        if (detailJobId === pin.jobId) {
          detailGeneration.current += 1;
          setDetail(null);
          setDetailJobId(null);
        }
        return current.filter((item) => item.jobId !== pin.jobId);
      }
      if (current.length >= 24) {
        setMessage("The batch limit is 24 deliveries; this delivery was omitted.");
        return current;
      }
      return [...current, { jobId: pin.jobId, status: pin.status, version: pin.version }];
    });
    invalidatePreview();
  }

  async function loadDetail(pin: DeliveryMapPin) {
    const locationId = location.locationId;
    if (!locationId) return;
    const generation = ++detailGeneration.current;
    setDetailJobId(pin.jobId);
    setDetail(null);
    const query = contextQuery(locationId, mode, cycleId.trim());
    query.set("jobId", pin.jobId);
    query.set("expectedVersion", String(pin.version));
    try {
      const result = await readResult<DeliveryMapDetail>(
        await fetchImpl(`/api/admin/delivery-map/detail?${query}`, { credentials: "same-origin" }),
      );
      if (
        generation !== detailGeneration.current ||
        !selectedRef.current.some((item) => item.jobId === pin.jobId)
      )
        return;
      if (result.ok) setDetail(result.value);
      else setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
    } catch {
      if (generation === detailGeneration.current)
        setMessage("Protected delivery detail could not be loaded.");
    }
  }

  function pointActivate(jobId: string) {
    const pin = view?.pins.find((candidate) => candidate.jobId === jobId);
    if (!pin) return;
    const wasSelected = selected.some((item) => item.jobId === jobId);
    togglePin(pin);
    if (!wasSelected && pin.selection.selectable) void loadDetail(pin);
  }

  function selectArea(firstCorner: MapCoordinate, secondCorner: MapCoordinate) {
    setAreaSelectionActive(false);
    const candidates = pinsInsideBounds(view?.pins ?? [], { firstCorner, secondCorner });
    setSelected((current) => {
      const known = new Set(current.map((item) => item.jobId));
      const additions = candidates.filter((pin) => !known.has(pin.jobId));
      const available = Math.max(0, 24 - current.length);
      const accepted = additions.slice(0, available);
      const omitted = additions.length - accepted.length;
      setMessage(
        omitted > 0
          ? `${accepted.length} deliveries selected; ${omitted} omitted because a batch is limited to 24.`
          : `${accepted.length} deliveries selected from the area.`,
      );
      return [
        ...current,
        ...accepted.map((pin) => ({ jobId: pin.jobId, status: pin.status, version: pin.version })),
      ];
    });
    invalidatePreview();
  }

  const previewRoute = async () => {
    const locationId = location.locationId;
    if (!locationId || !selected.length) return;
    invalidatePreview();
    try {
      const result = await readResult<BatchRoutePreview>(
        await fetchImpl("/api/admin/delivery-map/route-preview", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locationId,
            fulfillmentMode: mode,
            cycleId: mode === "INSTANT" ? null : cycleId.trim(),
            orderedDeliveries: selected.map(({ jobId, version }) => ({
              jobId,
              expectedVersion: version,
            })),
          }),
        }),
      );
      if (result.ok) {
        setPreview(result.value);
        setMessage(
          result.value.outcome === "WARNING"
            ? result.value.warning.message
            : "Route preview updated.",
        );
      } else setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
    } catch {
      setMessage("Route preview could not be loaded; assignment remains available.");
    }
  };

  const confirmAssignment = async () => {
    const locationId = location.locationId;
    if (
      commandIntent.pending ||
      !locationId ||
      !riderId ||
      selected.length < 1 ||
      selected.length > 24
    )
      return;
    const submittedContextIdentity = contextIdentityRef.current;
    try {
      const result = await commandIntent.submit((idempotencyKey) =>
        fetchImpl("/api/admin/delivery-batches", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            locationId,
            fulfillmentMode: mode,
            cycleId: mode === "INSTANT" ? null : cycleId.trim(),
            riderId,
            orderedDeliveries: selected.map(({ jobId, version }) => ({
              jobId,
              expectedVersion: version,
            })),
          }),
        }).then(readResult<DeliveryBatchView>),
      );
      if (submittedContextIdentity !== contextIdentityRef.current) {
        setMessage(
          "An assignment response arrived for the previous context; current deliveries were not replaced.",
        );
        return;
      }
      if (result.ok) {
        setMessage(`Batch ${result.value.batchId} was created and assigned.`);
        await loadWorkspace();
      } else if (result.error.code === "STALE_VERSION" || result.error.code === "CONFLICT") {
        setMessage(
          `Assignments changed. Authoritative deliveries were refreshed. Request reference: ${result.error.requestId}`,
        );
        await loadWorkspace();
      } else {
        setMessage(`${result.error.message} Request reference: ${result.error.requestId}`);
      }
    } catch {
      setMessage("The assignment result is unknown. Retry will use the same idempotency key.");
    }
  };

  const selectedIds = selected.map((item) => item.jobId);
  const scene = useMemo<MapScene>(
    () => ({
      points: (view?.pins ?? []).flatMap((pin) =>
        pin.coordinate
          ? [
              {
                id: pin.jobId,
                position: pin.coordinate,
                label: `${pin.jobId}: ${pin.status}`,
                tone: pointTone(pin),
              },
            ]
          : [],
      ),
      clusterPoints: true,
      selectedPointIds: selectedIds,
      areaSelectionActive,
      lineStrings:
        preview?.outcome === "AVAILABLE"
          ? [
              {
                id: "route-preview",
                points: preview.geometry.coordinates.map(([longitude, latitude]) => ({
                  longitude,
                  latitude,
                })),
              },
            ]
          : [],
    }),
    [areaSelectionActive, preview, selectedIds.join("|"), view],
  );

  const filtered = Boolean(statusFilter || riderFilter);
  const contextLabel = `${location.label}; ${mode}${mode === "SCHEDULED" ? ` cycle ${cycleId.trim()}` : ""}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery dispatch map"
        description="Build and assign a manually ordered delivery batch from Core-authorized work."
      />
      <FilterBar>
        <fieldset className="flex min-h-11 items-center gap-3">
          <legend className="sr-only">Fulfillment mode</legend>
          {(["INSTANT", "SCHEDULED"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="dispatch-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {value === "INSTANT" ? "Instant" : "Scheduled"}
            </label>
          ))}
        </fieldset>
        {mode === "SCHEDULED" ? (
          <label className="text-sm font-medium">
            Cycle ID
            <input
              className="ml-2 min-h-11 rounded border px-3"
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
              required
            />
          </label>
        ) : null}
        <label className="text-sm font-medium">
          Status
          <select
            className="ml-2 min-h-11 rounded border bg-white px-3"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {deliveryJobStates.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Rider filter
          <select
            className="ml-2 min-h-11 rounded border bg-white px-3"
            value={riderFilter}
            onChange={(event) => setRiderFilter(event.target.value)}
          >
            <option value="">All Riders</option>
            {riders.map((rider) => (
              <option key={rider.riderId} value={rider.riderId}>
                {rider.displayName}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

      <AdminLiveRegion message={message} />
      {!location.locationId ? (
        <AdminPageState
          state="permission-empty"
          title="Select a permitted location"
          message={location.label}
        />
      ) : mode === "SCHEDULED" && !cycleId.trim() ? (
        <AdminPageState
          state="empty"
          title="Choose a Scheduled cycle"
          message="A non-empty cycle is required before deliveries can load."
        />
      ) : state.phase === "loading" ? (
        <AdminPageState state="loading" title="Loading delivery map and eligible Riders" />
      ) : state.phase === "permission" ? (
        <AdminPageState
          state="permission-empty"
          title="Dispatch access unavailable"
          message={`${state.message}${state.requestId ? ` Request reference: ${state.requestId}` : ""}`}
        />
      ) : state.phase === "error" ? (
        <AdminPageState
          state="error"
          message={state.message}
          requestId={state.requestId}
          onRetry={() => void loadWorkspace()}
        />
      ) : state.phase === "ready" && view?.pins.length === 0 ? (
        <AdminPageState
          state={filtered ? "filtered-empty" : "empty"}
          title={filtered ? "No matching deliveries" : "No open deliveries"}
        />
      ) : state.phase === "ready" && view ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">
            <section
              aria-labelledby="dispatch-map-title"
              className="space-y-3 rounded border bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="dispatch-map-title" className="font-semibold">
                    Delivery map
                  </h2>
                  <ul
                    aria-label="Map legend"
                    className="flex flex-wrap gap-x-3 text-xs text-[var(--fm-text-muted)]"
                  >
                    <li>● Available</li>
                    <li>◆ Retry</li>
                    <li>■ Assigned</li>
                    <li>× Blocked</li>
                  </ul>
                </div>
                <Button
                  type="button"
                  variant={areaSelectionActive ? "destructive" : "outline"}
                  onClick={() => setAreaSelectionActive((active) => !active)}
                >
                  {areaSelectionActive ? "Cancel area selection" : "Select Area"}
                </Button>
              </div>
              <MapboxMap
                publicAccessToken={publicAccessToken}
                adapter={mapAdapter}
                initialView={{ center: CEBU_CENTER, zoom: 12 }}
                scene={scene}
                ariaLabel="Delivery dispatch map"
                className="h-[24rem] w-full rounded"
                fallback={<p className="text-sm">Use the delivery table below to continue.</p>}
                onPointActivate={pointActivate}
                onAreaSelect={selectArea}
                onAreaSelectionCancel={() => {
                  setAreaSelectionActive(false);
                  setMessage("Area selection canceled.");
                }}
              />
            </section>

            <ListPageSection
              title="Open deliveries"
              description={`${view.pins.length} deliveries in the current context`}
            >
              <Table aria-label="Open deliveries">
                <TableHeader>
                  <TableRow>
                    <TableHead>Select</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Map</TableHead>
                    <TableHead>Eligibility</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.pins.map((pin) => {
                    const checked = selectedIds.includes(pin.jobId);
                    return (
                      <TableRow key={pin.jobId} data-selected={checked || undefined}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${pin.jobId}`}
                            checked={checked}
                            disabled={!pin.selection.selectable}
                            aria-describedby={
                              !pin.selection.selectable ? `reason-${pin.jobId}` : undefined
                            }
                            onCheckedChange={() => togglePin(pin)}
                          />
                        </TableCell>
                        <TableCell>
                          <span className="block font-mono text-xs">{pin.jobId}</span>
                          <span className="text-xs text-[var(--fm-text-muted)]">
                            Order {pin.orderId}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={statusTone(pin.status)}>{pin.status}</StatusBadge>
                        </TableCell>
                        <TableCell>{pin.rider?.displayName ?? "Unassigned"}</TableCell>
                        <TableCell>
                          {pin.coordinate ? "Coordinate available" : "No coordinate"}
                        </TableCell>
                        <TableCell id={`reason-${pin.jobId}`}>
                          {pin.selection.selectable
                            ? "Selectable"
                            : (pin.selection.reason ?? "Not selectable")}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="link"
                            disabled={!checked}
                            onClick={() => void loadDetail(pin)}
                          >
                            View detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ListPageSection>
          </div>
          <SelectedDeliveriesDrawer
            deliveries={selected}
            riders={riders}
            riderId={riderId}
            preview={preview}
            detail={detail}
            reviewing={reviewing}
            pending={commandIntent.pending}
            contextLabel={contextLabel}
            onRiderChange={(value) => {
              setRiderId(value);
              setReviewing(false);
            }}
            onReorder={(value) => {
              setSelected(value);
              invalidatePreview();
            }}
            onPreview={() => void previewRoute()}
            onReview={() => setReviewing(true)}
            onConfirm={() => void confirmAssignment()}
            onReviewingChange={setReviewing}
            onClear={clearIntent}
          />
        </div>
      ) : null}
    </div>
  );
}
