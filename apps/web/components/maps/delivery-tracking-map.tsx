"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryTrackingView, RpcResult } from "@freshmarkets/contracts";
import { useStorefrontRuntime } from "../storefront/storefront-runtime";
import { GoogleMap } from "./google-map";
import type { MapCoordinate } from "./map-types";

function description(value: DeliveryTrackingView): string {
  switch (value.availability) {
    case "LIVE":
    case "DELAYED":
      return "Rider's last reported location.";
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

export function DeliveryTrackingMap({ endpoint }: { endpoint: string }) {
  const { googleMapsBrowserApiKey, googleMapsMapId } = useStorefrontRuntime();
  const [snapshot, setSnapshot] = useState<DeliveryTrackingView | null>(null);
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
      setSnapshot((previous) =>
        result.value.availability === "UNAVAILABLE" && !result.value.rider && previous?.rider
          ? { ...result.value, availability: "DELAYED", rider: previous.rider }
          : result.value,
      );
      finished.current =
        result.value.availability === "FINISHED" || result.value.availability === "NOT_SUPPORTED";
      setError(false);
      if (!firstView.current && result.value.destination) {
        const fit = [result.value.destination, result.value.rider?.coordinate].filter(
          (point): point is MapCoordinate => Boolean(point),
        );
        firstView.current = { center: result.value.destination, fit };
      }
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setLoading(false);
      inFlight.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
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
          : snapshot
            ? description(snapshot)
            : "Delivery tracking could not be loaded."}
        {rider
          ? ` Reported ${new Date(rider.updatedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}.`
          : ""}
      </p>
      {error ? (
        <button type="button" className="text-sm underline" onClick={() => void load()}>
          Retry tracking
        </button>
      ) : null}
      {showMap && firstView.current ? (
        <GoogleMap
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
          }}
          ariaLabel="Delivery tracking map"
          className="h-64 w-full overflow-hidden rounded-md sm:h-80"
          fallback={<p className="text-sm">Map is unavailable. Delivery status is shown above.</p>}
        />
      ) : null}
    </div>
  );
}
