"use client";
import { useEffect, useRef, useState } from "react";
import {
  addressPredictionsSchema,
  resolveAddressPrediction,
} from "../../lib/maps/address-predictions";
import type {
  AddressSearchCandidate,
  AddressPrediction,
  Coordinate,
} from "@freshmarkets/contracts";
import { GoogleMap } from "../maps/google-map";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const center = { latitude: 10.3157, longitude: 123.8854 };
export function LocationAddressMap({
  browserApiKey,
  mapId,
  coordinate,
  disabled,
  onCandidate,
  onCoordinate,
}: {
  browserApiKey?: string;
  mapId?: string;
  coordinate: Coordinate | null;
  disabled: boolean;
  onCandidate: (candidate: AddressSearchCandidate) => void;
  onCoordinate: (point: Coordinate, source: "USER_PIN" | "DEVICE_LOCATION") => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly AddressPrediction[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const searchTimer = useRef<number | null>(null);
  const sessionToken = useRef<string | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const live = useRef({ mounted: true, disabled, onCoordinate });
  live.current.disabled = disabled;
  live.current.onCoordinate = onCoordinate;
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      searchGeneration.current += 1;
      detailAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (disabled || query.trim().length < 2) return;
    const timer = window.setTimeout(() => void search(), 300);
    searchTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      searchGeneration.current += 1;
    };
  }, [query, disabled]);
  async function search() {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    if (disabled || query.trim().length < 2) return;
    sessionToken.current ??= crypto.randomUUID();
    const generation = ++searchGeneration.current;
    setSearching(true);
    setNotice(null);
    setResults([]);
    try {
      const response = await fetch("/api/commerce/address-autocomplete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          proximity: coordinate ?? center,
          sessionToken: sessionToken.current,
        }),
      });
      const parsed = addressPredictionsSchema.safeParse(await response.json());
      if (generation !== searchGeneration.current) return;
      if (!response.ok || !parsed.success) {
        setNotice("Address search is unavailable. You can enter and confirm the address manually.");
        return;
      }
      setResults(parsed.data.value);
      if (parsed.data.value.length === 0) setNotice("No addresses found. Refine your search.");
    } catch {
      if (generation === searchGeneration.current)
        setNotice("Address search could not be completed. Retry or enter the address manually.");
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }
  async function selectPrediction(prediction: AddressPrediction) {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    const generation = ++searchGeneration.current;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setNotice("Loading address details…");
    const token = sessionToken.current ?? crypto.randomUUID();
    sessionToken.current = null;
    try {
      const candidate = await resolveAddressPrediction(
        prediction.candidateKey,
        token,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        generation !== searchGeneration.current ||
        !live.current.mounted ||
        live.current.disabled
      )
        return;
      onCandidate(candidate);
      setResults([]);
      setNotice("Review the address and adjust the pin to the exact pickup entrance.");
    } catch {
      if (!controller.signal.aborted && generation === searchGeneration.current)
        setNotice("Address details could not be loaded. Search again or place the pin manually.");
    }
  }
  function device() {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    const generation = ++searchGeneration.current;
    detailAbort.current?.abort();
    if (!navigator.geolocation) {
      setNotice("Device location is unavailable.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (
          !live.current.mounted ||
          live.current.disabled ||
          generation !== searchGeneration.current
        )
          return;
        live.current.onCoordinate(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          "DEVICE_LOCATION",
        );
        setNotice("Review the device pin and address before saving.");
      },
      () => {
        if (live.current.mounted && generation === searchGeneration.current)
          setNotice("Device location could not be read. You can set the coordinates manually.");
      },
      { timeout: 10000 },
    );
  }
  return (
    <section
      aria-labelledby="fulfillment-location-pin-heading"
      className="space-y-4 rounded-lg border bg-muted/20 p-4 sm:col-span-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="fulfillment-location-pin-heading" className="font-semibold">
            Fulfillment location pin
          </h3>
          <p className="text-sm text-muted-foreground">
            Search, click the map, or drag the pin to the exact courier pickup entrance.
          </p>
        </div>
        <span
          className={
            coordinate
              ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800"
              : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
          }
        >
          {coordinate ? "Pin set" : "Pin required"}
        </span>
      </div>
      <div>
        <Label htmlFor="location-address-search">Find pickup address</Label>
        <div className="flex gap-2">
          <Input
            id="location-address-search"
            value={query}
            disabled={disabled}
            autoComplete="off"
            placeholder="Search an address, building or landmark"
            onChange={(event) => {
              searchGeneration.current += 1;
              detailAbort.current?.abort();
              setSearching(false);
              setResults([]);
              setQuery(event.target.value);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || searching || query.trim().length < 2}
            onClick={() => void search()}
          >
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {results.length > 0 && (
        <ul className="space-y-2">
          <li
            className="text-xs font-normal not-italic tracking-normal text-[#5e5e5e] whitespace-nowrap"
            translate="no"
          >
            Google Maps
          </li>
          {results.map((candidate) => (
            <li key={candidate.candidateKey}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal text-left"
                disabled={disabled}
                onClick={() => void selectPrediction(candidate)}
              >
                {candidate.displayAddress}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <GoogleMap
        browserApiKey={browserApiKey}
        mapId={mapId}
        initialView={{ center: coordinate ?? center, zoom: 13 }}
        ariaLabel="Fulfillment location pin map"
        className="h-80 w-full rounded-md border"
        scene={{
          draggablePin:
            coordinate && !disabled
              ? { position: coordinate, label: "Fulfillment pickup pin" }
              : undefined,
          points:
            coordinate && disabled
              ? [{ id: "origin", position: coordinate, label: "Fulfillment pickup pin" }]
              : [],
        }}
        onPinMove={(point) => {
          if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
          searchGeneration.current += 1;
          detailAbort.current?.abort();
          if (!disabled) onCoordinate(point, "USER_PIN");
        }}
        onMapClick={(point) => {
          if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
          searchGeneration.current += 1;
          detailAbort.current?.abort();
          if (!disabled) onCoordinate(point, "USER_PIN");
        }}
        fallback={<p className="text-sm">Enter the confirmed latitude and longitude below.</p>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" disabled={disabled} onClick={device}>
          Use current location
        </Button>
        <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
          {coordinate
            ? `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`
            : "No pickup pin selected"}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        This pin is saved on this location and used as the Lalamove pickup origin. For customer
        fulfillment sites, it also participates in nearest-location assignment.
      </p>
    </section>
  );
}
