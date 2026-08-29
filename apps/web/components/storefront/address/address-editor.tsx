"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type {
  AddressComponents,
  AddressComponentsSource,
  AddressSearchCandidate,
  AppError,
  Coordinate,
  CoordinateConfirmationSource,
  CustomerAddressView,
  DeliveryInstructions,
  RpcResult,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import { MapboxMap } from "../../maps/mapbox-map";
import type { MapAdapter } from "../../maps/map-types";

const CEBU_CENTER = { latitude: 10.3157, longitude: 123.8854 } as const;
const SEARCH_DEBOUNCE_MILLISECONDS = 300;

const emptyComponents: AddressComponents = {
  addressLine1: "",
  addressLine2: null,
  barangay: null,
  city: "",
  region: null,
  postalCode: null,
  countryCode: "PH",
};
const emptyInstructions: DeliveryInstructions = {
  buildingUnit: null,
  landmark: null,
  gateGuard: null,
  deliveryNote: null,
  recipientInstruction: null,
};

type FieldErrors = Partial<
  Record<"label" | "recipient" | "phone" | "addressLine1" | "city", string>
>;

export type AddressEditorProps = Readonly<{
  onConfirmed?: (addressId: string) => void;
  purpose?: "save" | "serviceability";
  initialAddress?: CustomerAddressView;
  publicAccessToken?: string;
  mapAdapter?: MapAdapter;
  fetchImpl?: typeof fetch;
  geolocation?: Geolocation;
}>;

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeSearchMessage(code?: string): string {
  if (code === "GEOCODER_RATE_LIMITED")
    return "Address search is busy right now. Please wait a moment and try again.";
  return "Address search is temporarily unavailable. Please try again.";
}

function safeSaveMessage(error?: AppError): string {
  if (error?.code === "UNAUTHENTICATED") return "Sign in to save this delivery address.";
  if (error?.code === "STALE_VERSION")
    return "This address changed elsewhere. Refresh it before saving again.";
  if (error?.code.startsWith("GEOCODER_"))
    return "Address confirmation is temporarily unavailable. Your entries were not lost.";
  return "The address could not be saved. Please review it and try again.";
}

function componentsForServiceability(components: AddressComponents): Record<string, string> {
  return Object.fromEntries(
    Object.entries(components).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function TextField({
  id,
  label,
  description,
  error,
  ...properties
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  description?: string;
  error?: string;
}) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  return (
    <label htmlFor={id} className="grid gap-1 text-sm font-medium text-slate-800">
      {label}
      <input
        id={id}
        {...properties}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950"
      />
      {description ? (
        <span id={descriptionId} className="text-xs font-normal text-slate-600">
          {description}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="text-xs font-normal text-red-700">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function TextAreaField({
  id,
  label,
  description,
  ...properties
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  description?: string;
}) {
  const descriptionId = `${id}-description`;
  return (
    <label htmlFor={id} className="grid gap-1 text-sm font-medium text-slate-800">
      {label}
      <textarea
        id={id}
        {...properties}
        aria-describedby={description ? descriptionId : undefined}
        className="min-h-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950"
      />
      {description ? (
        <span id={descriptionId} className="text-xs font-normal text-slate-600">
          {description}
        </span>
      ) : null}
    </label>
  );
}

export function AddressEditor({
  onConfirmed,
  purpose = "save",
  initialAddress,
  publicAccessToken,
  mapAdapter,
  fetchImpl = fetch,
  geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation,
}: AddressEditorProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReadonlyArray<AddressSearchCandidate>>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const [label, setLabel] = useState(initialAddress?.label ?? "");
  const [recipient, setRecipient] = useState(initialAddress?.recipient ?? "");
  const [phone, setPhone] = useState(initialAddress?.phone ?? "");
  const [components, setComponents] = useState(initialAddress?.components ?? emptyComponents);
  const [componentsSource, setComponentsSource] = useState<AddressComponentsSource>(
    initialAddress ? "SAVED_ADDRESS" : "FIRST_PARTY",
  );
  const [instructions, setInstructions] = useState(
    initialAddress?.instructions ?? emptyInstructions,
  );
  const [notes, setNotes] = useState("");
  const [coordinate, setCoordinate] = useState<Coordinate | null>(
    initialAddress
      ? { latitude: initialAddress.latitude, longitude: initialAddress.longitude }
      : null,
  );
  const [confirmationSource, setConfirmationSource] = useState<CoordinateConfirmationSource | null>(
    initialAddress?.confirmationSource ?? null,
  );
  const [selectedDisplayAddress, setSelectedDisplayAddress] = useState(
    initialAddress?.components.addressLine1 ?? "",
  );
  const [coordinateAnnouncement, setCoordinateAnnouncement] = useState("");
  const [serviceability, setServiceability] = useState<ServiceabilityResult | null>(null);
  const [serviceabilityState, setServiceabilityState] = useState<
    "idle" | "checking" | "ready" | "error"
  >("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const serviceabilityAbortRef = useRef<AbortController | null>(null);
  const serviceabilityGenerationRef = useRef(0);
  const coordinateActionGenerationRef = useRef(0);
  const providerResolvedComponents = confirmationSource === "GEOCODER";

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setCandidates([]);
      setSearchState("idle");
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchState("searching");
      setSearchError("");
      void fetchImpl("/api/commerce/address-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
        cache: "no-store",
        signal: controller.signal,
        credentials: "same-origin",
      })
        .then(async (response) => {
          const result = (await response.json()) as RpcResult<
            ReadonlyArray<AddressSearchCandidate>
          >;
          if (controller.signal.aborted) return;
          if (!response.ok || !result.ok) {
            const code = result.ok ? undefined : result.error.code;
            setCandidates([]);
            setSearchState("error");
            setSearchError(safeSearchMessage(code));
            return;
          }
          setCandidates(result.value);
          setSearchState("idle");
        })
        .catch((error: unknown) => {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          setCandidates([]);
          setSearchState("error");
          setSearchError(safeSearchMessage());
        });
    }, SEARCH_DEBOUNCE_MILLISECONDS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchImpl, query]);

  useEffect(
    () => () => {
      coordinateActionGenerationRef.current += 1;
      serviceabilityGenerationRef.current += 1;
      serviceabilityAbortRef.current?.abort();
    },
    [],
  );

  async function resolveCoordinate(
    nextCoordinate: Coordinate,
    nextComponents: AddressComponents,
  ): Promise<void> {
    const generation = ++serviceabilityGenerationRef.current;
    serviceabilityAbortRef.current?.abort();
    const controller = new AbortController();
    serviceabilityAbortRef.current = controller;
    const isCurrent = (): boolean =>
      generation === serviceabilityGenerationRef.current &&
      serviceabilityAbortRef.current === controller &&
      !controller.signal.aborted;
    setServiceabilityState("checking");
    setServiceability(null);
    try {
      const response = await fetchImpl("/api/serviceability", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...nextCoordinate,
          addressComponents: componentsForServiceability(nextComponents),
        }),
        signal: controller.signal,
      });
      const result = (await response.json()) as RpcResult<ServiceabilityResult>;
      if (!isCurrent()) return;
      if (!response.ok || !result.ok) {
        setServiceabilityState("error");
        return;
      }
      setServiceability(result.value);
      setServiceabilityState("ready");
    } catch (error) {
      if (!isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
      setServiceabilityState("error");
    }
  }

  function chooseCandidate(candidate: AddressSearchCandidate): void {
    coordinateActionGenerationRef.current += 1;
    setLocationError("");
    setComponents(candidate.components);
    setComponentsSource("TEMPORARY_GEOCODER");
    setCoordinate(candidate.coordinate);
    setConfirmationSource("GEOCODER");
    setSelectedDisplayAddress(candidate.displayAddress);
    setCoordinateAnnouncement("Search result selected. Review the pin location before saving.");
    setCandidates([]);
    void resolveCoordinate(candidate.coordinate, candidate.components);
  }

  function movePin(nextCoordinate: Coordinate): void {
    coordinateActionGenerationRef.current += 1;
    setLocationError("");
    setCoordinate(nextCoordinate);
    setConfirmationSource("USER_PIN");
    setCoordinateAnnouncement("Pin location updated.");
    void resolveCoordinate(nextCoordinate, components);
  }

  function useCurrentLocation(): void {
    const generation = ++coordinateActionGenerationRef.current;
    setLocationError("");
    if (!geolocation) {
      setLocationError(
        "Current location is not available in this browser. Search for an address instead.",
      );
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        if (generation !== coordinateActionGenerationRef.current) return;
        const nextCoordinate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoordinate(nextCoordinate);
        setConfirmationSource("DEVICE_LOCATION");
        setSelectedDisplayAddress("Current device location");
        setCoordinateAnnouncement(
          "Current location selected. Review the address details before saving.",
        );
        void resolveCoordinate(nextCoordinate, components);
      },
      () => {
        if (generation !== coordinateActionGenerationRef.current) return;
        setLocationError(
          "Location permission was not granted. Search for an address or enable location access and try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!label.trim()) errors.label = "Enter a label for this address.";
    if (!recipient.trim()) errors.recipient = "Enter the delivery recipient.";
    if (!phone.trim()) errors.phone = "Enter a contact phone number.";
    if (!components.addressLine1.trim()) errors.addressLine1 = "Enter the street or building.";
    if (!components.city.trim()) errors.city = "Enter the city.";
    return errors;
  }

  function setFirstPartyComponent<Key extends keyof AddressComponents>(
    key: Key,
    value: AddressComponents[Key],
  ): void {
    setComponents((current) => ({
      ...(componentsSource === "TEMPORARY_GEOCODER" ? emptyComponents : current),
      [key]: value,
    }));
    setComponentsSource("FIRST_PARTY");
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (purpose !== "save") return;
    setSaveError("");
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !coordinate || !confirmationSource) {
      if (!coordinate || !confirmationSource)
        setSaveError("Choose a search result, current location, or map pin before saving.");
      return;
    }
    setSaveState("saving");
    const method = initialAddress ? "PATCH" : "POST";
    const body = {
      ...(initialAddress
        ? { addressId: initialAddress.id, expectedVersion: initialAddress.version }
        : {}),
      label: label.trim(),
      recipient: recipient.trim(),
      phone: phone.trim(),
      components,
      componentsSource,
      ...coordinate,
      confirmationSource,
      instructions,
      ...(!initialAddress ? { notes: nullable(notes) } : {}),
    };
    try {
      const response = await fetchImpl("/api/commerce/address", {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as RpcResult<CustomerAddressView>;
      if (!response.ok || !result.ok) {
        setSaveState("error");
        setSaveError(safeSaveMessage(result.ok ? undefined : result.error));
        return;
      }
      setSaveState("idle");
      onConfirmed?.(result.value.id);
    } catch {
      setSaveState("error");
      setSaveError(safeSaveMessage());
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6" aria-label="Delivery address editor" noValidate>
      <section aria-labelledby="address-search-heading" className="grid gap-3">
        <div>
          <h2 id="address-search-heading" className="text-lg font-semibold text-slate-950">
            Find the delivery address
          </h2>
          <p id="address-search-help" className="mt-1 text-sm text-slate-600">
            Search within the Philippines. Results are biased toward Cebu and stay only in this
            editor.
          </p>
        </div>
        <TextField
          id="address-search"
          label="Search for an address"
          description="Choose a result, then move the map pin to the exact entrance if needed."
          autoComplete="street-address"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={useCurrentLocation}
          className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
        >
          Use current location
        </button>
        {locationError ? (
          <p role="alert" className="text-sm text-red-700">
            {locationError}
          </p>
        ) : null}
        {searchState === "searching" ? (
          <p role="status" aria-live="polite" className="text-sm text-slate-600">
            Searching for addresses…
          </p>
        ) : null}
        {searchError ? (
          <p role="alert" className="text-sm text-red-700">
            {searchError}
          </p>
        ) : null}
        {candidates.length > 0 ? (
          <ul aria-label="Address search results" className="divide-y rounded-lg border">
            {candidates.map((candidate) => (
              <li key={candidate.candidateKey}>
                <button
                  type="button"
                  onClick={() => chooseCandidate(candidate)}
                  className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 focus-visible:outline-2"
                >
                  {candidate.displayAddress}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="pin-confirmation-heading" className="grid gap-3">
        <div>
          <h2 id="pin-confirmation-heading" className="text-lg font-semibold text-slate-950">
            Confirm the exact entrance
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            The confirmed pin determines delivery coverage. Drag it when the suggested point is not
            exact.
          </p>
        </div>
        <MapboxMap
          publicAccessToken={publicAccessToken}
          adapter={mapAdapter}
          initialView={{ center: coordinate ?? CEBU_CENTER, zoom: 14 }}
          scene={{
            draggablePin: coordinate
              ? { position: coordinate, label: "Confirmed delivery entrance" }
              : undefined,
          }}
          onPinMove={movePin}
          ariaLabel="Delivery address pin confirmation map"
          className="min-h-72 rounded-xl border"
          fallback={
            <p className="text-sm text-slate-700">
              You can still choose a search result or use your current location, then confirm the
              selected address below.
            </p>
          }
        />
        {selectedDisplayAddress ? (
          <p className="text-sm text-slate-700">
            <span className="font-semibold">Selected address:</span> {selectedDisplayAddress}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          {coordinateAnnouncement}
        </p>
        {serviceabilityState === "checking" ? (
          <p role="status" aria-live="polite" className="text-sm text-slate-600">
            Checking delivery coverage…
          </p>
        ) : null}
        {serviceabilityState === "error" ? (
          <p role="alert" className="text-sm text-red-700">
            Delivery coverage could not be checked. You can retry by selecting the address or pin
            again.
          </p>
        ) : null}
        {serviceabilityState === "ready" && serviceability ? (
          <div
            role="status"
            aria-live="polite"
            className={
              serviceability.serviceable
                ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
                : "rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
            }
          >
            <p className="font-semibold">
              {serviceability.serviceable ? "Delivery is available" : "Delivery is unavailable"}
            </p>
            <p>
              {serviceability.serviceable
                ? "Core confirmed this pin is inside the current delivery area."
                : purpose === "save"
                  ? "You may save this address, but it cannot be used at checkout until corrected."
                  : "Try another address or adjust the pin to check a different entrance."}
            </p>
          </div>
        ) : null}
      </section>

      {purpose === "serviceability" ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          This coverage check is not saved. Sign in and use your address book when you are ready to
          keep a delivery address.
        </p>
      ) : (
        <>
          <section aria-labelledby="address-details-heading" className="grid gap-4">
            <h2 id="address-details-heading" className="text-lg font-semibold text-slate-950">
              Address and recipient details
            </h2>
            {providerResolvedComponents ? (
              <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                Search-result address fields are provider-resolved when saved. Move the pin to
                establish a first-party location before changing them; add unit, entrance, landmark,
                and rider guidance under Delivery instructions.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="address-label"
                label="Address label"
                description="For example, Home or Office."
                value={label}
                error={fieldErrors.label}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
              <TextField
                id="address-recipient"
                label="Recipient name"
                value={recipient}
                error={fieldErrors.recipient}
                onChange={(event) => setRecipient(event.currentTarget.value)}
              />
              <TextField
                id="address-phone"
                label="Phone number"
                type="tel"
                autoComplete="tel"
                description="Used only to coordinate this delivery."
                value={phone}
                error={fieldErrors.phone}
                onChange={(event) => setPhone(event.currentTarget.value)}
              />
              <TextField
                id="address-line-1"
                label="Street, building, or place"
                readOnly={providerResolvedComponents}
                value={components.addressLine1}
                error={fieldErrors.addressLine1}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFirstPartyComponent("addressLine1", value);
                }}
              />
              <TextField
                id="address-line-2"
                label="Additional address line"
                readOnly={providerResolvedComponents}
                value={components.addressLine2 ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setFirstPartyComponent("addressLine2", value);
                }}
              />
              <TextField
                id="address-barangay"
                label="Barangay"
                readOnly={providerResolvedComponents}
                value={components.barangay ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setFirstPartyComponent("barangay", value);
                }}
              />
              <TextField
                id="address-city"
                label="City"
                readOnly={providerResolvedComponents}
                value={components.city}
                error={fieldErrors.city}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFirstPartyComponent("city", value);
                }}
              />
              <TextField
                id="address-region"
                label="Region or province"
                readOnly={providerResolvedComponents}
                value={components.region ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setFirstPartyComponent("region", value);
                }}
              />
              <TextField
                id="address-postal-code"
                label="Postal code"
                readOnly={providerResolvedComponents}
                inputMode="numeric"
                value={components.postalCode ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setFirstPartyComponent("postalCode", value);
                }}
              />
            </div>
          </section>

          <section aria-labelledby="delivery-instructions-heading" className="grid gap-4">
            <div>
              <h2
                id="delivery-instructions-heading"
                className="text-lg font-semibold text-slate-950"
              >
                Delivery instructions
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Add only details a delivery rider needs for this destination.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="instruction-building-unit"
                label="Building or unit"
                value={instructions.buildingUnit ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setInstructions((current) => ({ ...current, buildingUnit: value }));
                }}
              />
              <TextField
                id="instruction-landmark"
                label="Landmark"
                value={instructions.landmark ?? ""}
                onChange={(event) => {
                  const value = nullable(event.currentTarget.value);
                  setInstructions((current) => ({ ...current, landmark: value }));
                }}
              />
            </div>
            <TextAreaField
              id="instruction-gate-guard"
              label="Gate or guard instructions"
              value={instructions.gateGuard ?? ""}
              onChange={(event) => {
                const value = nullable(event.currentTarget.value);
                setInstructions((current) => ({ ...current, gateGuard: value }));
              }}
            />
            <TextAreaField
              id="instruction-delivery-note"
              label="Delivery note"
              description="For example, where to leave groceries or when to call."
              maxLength={1000}
              value={instructions.deliveryNote ?? ""}
              onChange={(event) => {
                const value = nullable(event.currentTarget.value);
                setInstructions((current) => ({ ...current, deliveryNote: value }));
              }}
            />
            <TextAreaField
              id="instruction-recipient"
              label="Recipient guidance"
              maxLength={1000}
              value={instructions.recipientInstruction ?? ""}
              onChange={(event) => {
                const value = nullable(event.currentTarget.value);
                setInstructions((current) => ({ ...current, recipientInstruction: value }));
              }}
            />
            {!initialAddress ? (
              <TextAreaField
                id="address-notes"
                label="Private address note"
                description="Optional account note. Delivery instructions belong in the fields above."
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
              />
            ) : null}
          </section>

          {saveError ? (
            <p role="alert" className="text-sm text-red-700">
              {saveError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={saveState === "saving" || !coordinate || !confirmationSource}
            className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveState === "saving"
              ? "Saving address…"
              : serviceability?.serviceable === false
                ? "Save unavailable address"
                : initialAddress
                  ? "Update confirmed address"
                  : "Save confirmed address"}
          </button>
        </>
      )}
    </form>
  );
}
