"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DeliveryTrackingView, RpcResult } from "@freshmarkets/contracts";
import { useStorefrontRuntime } from "../storefront/storefront-runtime";
import { GoogleMap } from "./google-map";
import type { MapCoordinate } from "./map-types";

function description(value: DeliveryTrackingView): string {
  switch (value.availability) {
    case "LIVE":
      return "Rider's last reported location.";
    case "DELAYED":
      return "Rider's last reported location. Live updates are delayed.";
    case "WAITING":
      return "Waiting for the rider's location.";
    case "UNAVAILABLE":
      return "Rider location is temporarily unavailable.";
    case "FINISHED":
      return "This delivery has finished.";
    case "NOT_SUPPORTED":
      return "Live tracking is unavailable for this delivery.";
  }
}

export function DeliveryTrackingMap({
  endpoint,
  renderContact,
  mapClassName = "h-64 w-full overflow-hidden rounded-md sm:h-80",
}: {
  endpoint: string;
  renderContact?: (contact: DeliveryTrackingView["riderContact"]) => ReactNode;
  mapClassName?: string;
}) {
  const { googleMapsBrowserApiKey, googleMapsMapId } = useStorefrontRuntime();
  const [snapshot, setSnapshot] = useState<DeliveryTrackingView | null>(null);
  const lastSnapshot = useRef<DeliveryTrackingView | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const firstView = useRef<{ center: MapCoordinate; fit: readonly MapCoordinate[] } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const load = useCallback(async () => {
    if (finished.current || inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: request.signal });
      const result = (await response.json()) as RpcResult<DeliveryTrackingView>;
      if (request.signal.aborted) return;
      if (!result.ok) throw new Error("Tracking unavailable");
      const previous = lastSnapshot.current;
      const sameAttempt =
        result.value.attemptId !== null && result.value.attemptId === previous?.attemptId;
      if (previous?.attemptId !== result.value.attemptId) firstView.current = null;
      const sameRiderPosition =
        sameAttempt &&
        previous?.rider?.coordinate.latitude === result.value.rider?.coordinate.latitude &&
        previous?.rider?.coordinate.longitude === result.value.rider?.coordinate.longitude;
      const nextSnapshot: DeliveryTrackingView =
        result.value.availability === "UNAVAILABLE" &&
        !result.value.rider &&
        sameAttempt &&
        previous?.rider
          ? {
              ...result.value,
              availability: "DELAYED",
              rider: previous.rider,
              roadRoute: previous.roadRoute,
            }
          : sameRiderPosition && !result.value.roadRoute
            ? { ...result.value, roadRoute: previous.roadRoute }
            : result.value;
      lastSnapshot.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      finished.current =
        result.value.availability === "FINISHED" || result.value.availability === "NOT_SUPPORTED";
      setError(false);
      if (!firstView.current && nextSnapshot.destination) {
        const fit = [nextSnapshot.destination, nextSnapshot.rider?.coordinate].filter(
          (point): point is MapCoordinate => Boolean(point),
        );
        firstView.current = { center: nextSnapshot.destination, fit };
      }
    } catch {
      if (!request.signal.aborted) {
        setError(true);
        if (lastSnapshot.current) {
          const stale = { ...lastSnapshot.current, riderContact: null };
          lastSnapshot.current = stale;
          setSnapshot(stale);
        }
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
      inFlight.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
    lastSnapshot.current = null;
    setSnapshot(null);
    setLoading(true);
    setError(false);
    firstView.current = null;
    finished.current = false;
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      controller.current?.abort();
      inFlight.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [endpoint, load]);

  const destination = snapshot?.destination;
  const rider = snapshot?.rider;
  const showMap =
    destination &&
    snapshot?.availability !== "NOT_SUPPORTED" &&
    snapshot?.availability !== "FINISHED";
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm">
        {loading && !snapshot
          ? "Loading delivery tracking…"
          : error && snapshot
            ? "Live updates are unavailable. Showing the last confirmed delivery view."
            : snapshot
              ? description(snapshot)
              : "Delivery tracking could not be loaded."}
      </p>
      {error ? (
        <button type="button" className="text-sm underline" onClick={() => void load()}>
          Retry tracking
        </button>
      ) : null}
      {showMap && firstView.current ? (
        <GoogleMap
          key={snapshot?.attemptId ?? "unassigned"}
          browserApiKey={googleMapsBrowserApiKey}
          mapId={googleMapsMapId}
          initialView={{ center: firstView.current.center, zoom: 14 }}
          fitBoundsOnInitialize={firstView.current.fit}
          scene={{
            fitBoundsOnce: rider ? [destination, rider.coordinate] : undefined,
            points: [
              {
                id: "destination",
                position: destination,
                label: "Delivery destination",
                tone: "available",
              },
              ...(rider
                ? [
                    {
                      id: "rider",
                      position: rider.coordinate,
                      label: "Rider's last reported location",
                      tone: "assigned" as const,
                      kind: "motorcycle" as const,
                    },
                  ]
                : []),
            ],
            lineStrings:
              rider && snapshot?.roadRoute
                ? [{ id: "suggested-road-route", points: snapshot.roadRoute, tone: "storefront" }]
                : undefined,
          }}
          ariaLabel="Delivery tracking map"
          className={mapClassName}
          fallback={<p className="text-sm">Map is unavailable. Delivery status is shown above.</p>}
        />
      ) : null}
      {rider && showMap ? (
        <p className="text-xs text-muted-foreground">
          {snapshot?.roadRoute
            ? "Green line shows a suggested road route from the rider’s last reported location. The rider may take a different road."
            : "Suggested road route is unavailable. The pins show the last reported rider location and destination."}
        </p>
      ) : null}
      {snapshot && !["FINISHED", "NOT_SUPPORTED"].includes(snapshot.availability)
        ? renderContact?.(snapshot.riderContact ?? null)
        : null}
    </div>
  );
}
