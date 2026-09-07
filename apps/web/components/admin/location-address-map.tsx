"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "@freshmarkets/validation";
import type { AddressSearchCandidate, Coordinate } from "@freshmarkets/contracts";
import { MapboxMap } from "../maps/mapbox-map";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const nullableText = z.string().nullable();
const candidatesSchema = z.object({
  ok: z.literal(true),
  value: z.array(
    z.object({
      candidateKey: z.string(),
      displayAddress: z.string(),
      coordinate: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      components: z.object({
        addressLine1: z.string(),
        addressLine2: nullableText,
        barangay: nullableText,
        city: z.string(),
        region: nullableText,
        postalCode: nullableText,
        countryCode: z.string(),
      }),
      accuracy: nullableText,
    }),
  ),
});
const center = { latitude: 10.3157, longitude: 123.8854 };
export function LocationAddressMap({
  publicAccessToken,
  coordinate,
  disabled,
  onCandidate,
  onCoordinate,
}: {
  publicAccessToken?: string;
  coordinate: Coordinate | null;
  disabled: boolean;
  onCandidate: (candidate: AddressSearchCandidate) => void;
  onCoordinate: (point: Coordinate, source: "USER_PIN" | "DEVICE_LOCATION") => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly AddressSearchCandidate[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const live = useRef({ mounted: true, disabled, onCoordinate });
  live.current.disabled = disabled;
  live.current.onCoordinate = onCoordinate;
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      searchGeneration.current += 1;
    };
  }, []);
  async function search() {
    const generation = ++searchGeneration.current;
    setSearching(true);
    setNotice(null);
    setResults([]);
    try {
      const response = await fetch("/api/commerce/address-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, proximity: coordinate ?? center }),
      });
      const parsed = candidatesSchema.safeParse(await response.json());
      if (generation !== searchGeneration.current) return;
      if (!parsed.success) {
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
  function device() {
    if (!navigator.geolocation) {
      setNotice("Device location is unavailable.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!live.current.mounted || live.current.disabled) return;
        live.current.onCoordinate(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          "DEVICE_LOCATION",
        );
        setNotice("Review the device pin and address before saving.");
      },
      () => {
        if (live.current.mounted)
          setNotice("Device location could not be read. You can set the coordinates manually.");
      },
      { timeout: 10000 },
    );
  }
  return (
    <div className="space-y-3 sm:col-span-2">
      <div>
        <Label htmlFor="location-address-search">Find store address</Label>
        <div className="flex gap-2">
          <Input
            id="location-address-search"
            value={query}
            onChange={(event) => {
              searchGeneration.current += 1;
              setSearching(false);
              setResults([]);
              setQuery(event.target.value);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || searching || !query.trim()}
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
          {results.map((candidate) => (
            <li key={candidate.candidateKey}>
              <Button
                type="button"
                variant="outline"
                className="h-auto whitespace-normal text-left"
                disabled={disabled}
                onClick={() => {
                  onCandidate(candidate);
                  setResults([]);
                  setNotice(
                    "Confirm the pin and address. Core will finalize the address when saving.",
                  );
                }}
              >
                {candidate.displayAddress}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MapboxMap
        publicAccessToken={publicAccessToken}
        initialView={{ center: coordinate ?? center, zoom: 13 }}
        ariaLabel="Store address map"
        className="h-72 w-full rounded-md border"
        scene={{
          draggablePin:
            coordinate && !disabled
              ? { position: coordinate, label: "Store pickup origin" }
              : undefined,
          points: coordinate ? [{ id: "origin", position: coordinate }] : [],
        }}
        onPinMove={(point) => {
          if (!disabled) onCoordinate(point, "USER_PIN");
        }}
        onMapClick={(point) => {
          if (!disabled) onCoordinate(point, "USER_PIN");
        }}
        fallback={<p className="text-sm">Enter the confirmed latitude and longitude below.</p>}
      />
      <Button type="button" variant="outline" disabled={disabled} onClick={device}>
        Use device location
      </Button>
      <p className="text-sm text-muted-foreground">
        Confirm the store entrance used for pickup. This coordinate is shared with the courier
        pickup profile.
      </p>
    </div>
  );
}
