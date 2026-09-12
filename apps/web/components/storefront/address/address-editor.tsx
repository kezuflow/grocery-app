"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  LocateFixed,
  Map,
  MapPin,
  Navigation,
  NotebookPen,
  Search,
  UserRound,
  X,
} from "lucide-react";
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
  AddressPrediction,
  AppError,
  Coordinate,
  CoordinateConfirmationSource,
  ConfirmedBrowsingLocation,
  CustomerAddressView,
  DeliveryInstructions,
  RpcResult,
  ServiceabilityResult,
} from "@freshmarkets/contracts";
import {
  addressPredictionsSchema,
  resolveAddressPrediction,
} from "../../../lib/maps/address-predictions";
import { GoogleMap } from "../../maps/google-map";
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
  onServiceabilityConfirmed?: (selection: ServiceabilitySelection) => void;
  purpose?: "save" | "serviceability";
  compact?: boolean;
  multiStep?: boolean;
  compactHeading?: string;
  initialAddress?: CustomerAddressView;
  defaultPhone?: string;
  savedPhoneNumbers?: readonly string[];
  browserApiKey?: string;
  mapId?: string;
  mapAdapter?: MapAdapter;
  fetchImpl?: typeof fetch;
  geolocation?: Geolocation;
}>;

export type ServiceabilitySelection = Readonly<ConfirmedBrowsingLocation>;

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePhilippineMobile(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("09")
    ? `+63${compact.slice(1)}`
    : compact.startsWith("639")
      ? `+${compact}`
      : compact;
  return /^\+639\d{9}$/.test(normalized) ? normalized : null;
}

function formatPhilippineMobileInput(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !digits.startsWith("63")) return `+${digits.slice(0, 12)}`;
  const international = trimmed.startsWith("+") || digits.startsWith("63");
  if (international) {
    const subscriber = (digits.startsWith("63") ? digits.slice(2) : digits).slice(0, 10);
    return ["+63", subscriber.slice(0, 3), subscriber.slice(3, 6), subscriber.slice(6, 10)]
      .filter(Boolean)
      .join(" ");
  }
  const local = digits.slice(0, 11);
  if (!local) return "";
  return [local.slice(0, 4), local.slice(4, 7), local.slice(7, 11)].filter(Boolean).join(" ");
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

function serviceabilityTitle(value: ServiceabilityResult): string {
  if (value.serviceable) return "Delivery area confirmed";
  return value.reason === "OUTSIDE_SERVICE_AREA"
    ? "Outside our delivery area"
    : "No fulfillment location available";
}

function serviceabilityMessage(value: ServiceabilityResult, purpose: "save" | "serviceability") {
  if (value.serviceable)
    return `${value.serviceArea?.name ?? "Service area"} · Fulfilled from ${value.fulfillmentLocation?.name ?? "the nearest location"}. Lalamove availability and the delivery fee are confirmed at checkout.`;
  if (value.reason === "OUTSIDE_SERVICE_AREA")
    return purpose === "save"
      ? "FreshMarkets does not deliver to this address yet. You may save it, but it cannot be used for checkout."
      : "FreshMarkets does not deliver to this address yet. Choose a pin inside an active service area.";
  return purpose === "save"
    ? "You may save this address, but ordering requires a ready fulfillment location."
    : "No active fulfillment location can currently prepare this order.";
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
  onServiceabilityConfirmed,
  purpose = "save",
  compact = false,
  multiStep = false,
  compactHeading,
  initialAddress,
  defaultPhone,
  savedPhoneNumbers = [],
  browserApiKey,
  mapId,
  mapAdapter,
  fetchImpl = fetch,
  geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation,
}: AddressEditorProps) {
  const wizard = multiStep && purpose === "save";
  const [step, setStep] = useState(1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (wizard) stepHeadingRef.current?.focus();
  }, [wizard, step]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if ((!compact && !wizard) || !searchExpanded) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSearchExpanded(false);
    }
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [compact, wizard, searchExpanded]);
  const searchWasExpanded = useRef(false);
  const restoreSearchFocus = useRef(true);
  useEffect(() => {
    if (!compact && !wizard) return;
    if (searchExpanded) {
      searchWasExpanded.current = true;
      searchInputRef.current?.focus();
      return;
    }
    if (searchWasExpanded.current) {
      searchWasExpanded.current = false;
      if (restoreSearchFocus.current) searchToggleRef.current?.focus();
      restoreSearchFocus.current = true;
    }
  }, [compact, wizard, searchExpanded]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReadonlyArray<AddressPrediction>>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const [label, setLabel] = useState(initialAddress?.label ?? "");
  const [recipient, setRecipient] = useState(initialAddress?.recipient ?? "");
  const [phone, setPhone] = useState(() =>
    formatPhilippineMobileInput(initialAddress?.phone ?? defaultPhone ?? ""),
  );
  const savedPhones = Array.from(
    new Set(
      [initialAddress?.phone, defaultPhone, ...savedPhoneNumbers]
        .map((value) => (value ? normalizePhilippineMobile(value) : null))
        .filter((value): value is string => Boolean(value)),
    ),
  );
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
  const [saveUncertain, setSaveUncertain] = useState(false);
  const pendingSave = useRef<{ method: "POST" | "PATCH"; key: string; body: string } | null>(null);
  const saveInFlight = useRef(false);
  const [locationError, setLocationError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const serviceabilityAbortRef = useRef<AbortController | null>(null);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const confirmationAbortRef = useRef<AbortController | null>(null);
  const serviceabilityGenerationRef = useRef(0);
  const coordinateActionGenerationRef = useRef(0);
  const initialMapCenterRef = useRef<Coordinate>(coordinate ?? CEBU_CENTER);
  const placesSession = useRef<string | null>(null);
  const providerResolvedComponents = confirmationSource === "GEOCODER";

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || ((compact || wizard) && !searchExpanded) || (wizard && step !== 1)) {
      setCandidates([]);
      setSearchState("idle");
      setSearchError("");
      return;
    }
    setCandidates([]);
    placesSession.current ??= crypto.randomUUID();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchState("searching");
      setSearchError("");
      void fetchImpl("/api/commerce/address-autocomplete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          sessionToken: placesSession.current,
          proximity: initialMapCenterRef.current,
        }),
        cache: "no-store",
        signal: controller.signal,
        credentials: "same-origin",
      })
        .then(async (response) => {
          const result = addressPredictionsSchema.safeParse(await response.json());
          if (controller.signal.aborted) return;
          if (!response.ok || !result.success) {
            const code = undefined;
            setCandidates([]);
            setSearchState("error");
            setSearchError(safeSearchMessage(code));
            return;
          }
          setCandidates(result.data.value);
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
  }, [fetchImpl, query, compact, searchExpanded, wizard, step]);

  useEffect(
    () => () => {
      coordinateActionGenerationRef.current += 1;
      serviceabilityGenerationRef.current += 1;
      reverseAbortRef.current?.abort();
      confirmationAbortRef.current?.abort();
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

  async function chooseCandidate(prediction: AddressPrediction): Promise<void> {
    const generation = ++coordinateActionGenerationRef.current;
    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;
    setCandidates([]);
    setSearchError("");
    setSearchState("searching");
    const token = placesSession.current ?? crypto.randomUUID();
    placesSession.current = null;
    let candidate: AddressSearchCandidate;
    try {
      candidate = await resolveAddressPrediction(
        prediction.candidateKey,
        token,
        controller.signal,
        fetchImpl,
      );
    } catch {
      if (!controller.signal.aborted && generation === coordinateActionGenerationRef.current) {
        setSearchState("error");
        setSearchError(
          "Address details could not be loaded. Search again or place the pin manually.",
        );
      }
      return;
    }
    if (controller.signal.aborted || generation !== coordinateActionGenerationRef.current) return;
    setSearchState("idle");
    setSearchExpanded(false);
    coordinateActionGenerationRef.current += 1;
    reverseAbortRef.current?.abort();
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

  async function confirmCoordinate(
    nextCoordinate: Coordinate,
    source: "USER_PIN" | "DEVICE_LOCATION",
    generation: number,
  ): Promise<void> {
    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;
    setLocationError("");
    setCoordinate(nextCoordinate);
    setConfirmationSource(source);
    setCoordinateAnnouncement(
      source === "DEVICE_LOCATION"
        ? "Current location selected. Finding the address…"
        : "Pin location updated. Finding the address…",
    );
    try {
      const response = await fetchImpl("/api/commerce/address-reverse", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: nextCoordinate }),
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json()) as RpcResult<AddressSearchCandidate>;
      if (
        controller.signal.aborted ||
        generation !== coordinateActionGenerationRef.current ||
        reverseAbortRef.current !== controller
      )
        return;
      if (!response.ok || !result.ok) {
        setLocationError(
          "The pin is selected, but its address details could not be filled automatically. Enter them below or try another point.",
        );
        setCoordinateAnnouncement("Pin location updated.");
        void resolveCoordinate(nextCoordinate, components);
        return;
      }
      setComponents(result.value.components);
      setComponentsSource("TEMPORARY_GEOCODER");
      setSelectedDisplayAddress(result.value.displayAddress);
      setCoordinateAnnouncement(
        source === "DEVICE_LOCATION"
          ? "Current location selected and address details filled. Review them before saving."
          : "Pin location updated and address details filled. Review them before saving.",
      );
      void resolveCoordinate(nextCoordinate, result.value.components);
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== coordinateActionGenerationRef.current ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      setLocationError(
        "The pin is selected, but its address details could not be filled automatically. Enter them below or try another point.",
      );
      setCoordinateAnnouncement("Pin location updated.");
      void resolveCoordinate(nextCoordinate, components);
    }
  }

  function movePin(nextCoordinate: Coordinate): void {
    if (purpose === "save" && (saveInFlight.current || saveUncertain)) return;
    const generation = ++coordinateActionGenerationRef.current;
    void confirmCoordinate(nextCoordinate, "USER_PIN", generation);
  }

  function useCurrentLocation(): void {
    const generation = ++coordinateActionGenerationRef.current;
    if (searchExpanded) restoreSearchFocus.current = false;
    setSearchExpanded(false);
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
        void confirmCoordinate(nextCoordinate, "DEVICE_LOCATION", generation);
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
    if (!normalizePhilippineMobile(phone))
      errors.phone = "Enter a Philippine mobile number, such as 0917 123 4567.";
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

  async function confirmBrowsing(): Promise<void> {
    if (!coordinate || !serviceability?.serviceable || saveState === "saving") return;
    const generation = coordinateActionGenerationRef.current;
    const controller = new AbortController();
    confirmationAbortRef.current?.abort();
    confirmationAbortRef.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted && generation === coordinateActionGenerationRef.current;
    setSaveState("saving");
    setSaveError("");
    try {
      const response = await fetchImpl("/api/commerce/browsing-location", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate }),
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json()) as RpcResult<ConfirmedBrowsingLocation>;
      if (!isCurrent()) return;
      if (!response.ok || !result.ok) {
        setSaveError("Address confirmation is temporarily unavailable. Please try again.");
        return;
      }
      if (!result.value.serviceability.serviceable) {
        setServiceability(result.value.serviceability);
        setSaveError(serviceabilityMessage(result.value.serviceability, "serviceability"));
        return;
      }
      onServiceabilityConfirmed?.(result.value);
    } catch {
      if (isCurrent())
        setSaveError("Address confirmation is temporarily unavailable. Please try again.");
    } finally {
      if (!controller.signal.aborted) setSaveState("idle");
    }
  }

  function continueStep() {
    setSaveError("");
    if (step === 1 && (!coordinate || !confirmationSource || serviceabilityState !== "ready")) {
      setSaveError("Choose an address and wait for fulfillment-location assignment.");
      return;
    }
    if (step === 2) {
      const errors = validate();
      setFieldErrors(errors);
      if (Object.keys(errors).length) {
        setSaveError("Complete the required address and recipient details.");
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (purpose !== "save" || saveInFlight.current) return;
    if (wizard && step < 3) {
      continueStep();
      return;
    }
    setSaveError("");
    if (!pendingSave.current) {
      const errors = validate();
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0 || !coordinate || !confirmationSource) {
        if (!coordinate || !confirmationSource)
          setSaveError("Choose a search result, current location, or map pin before saving.");
        return;
      }
      const method = initialAddress ? "PATCH" : "POST";
      const body = {
        ...(initialAddress
          ? { addressId: initialAddress.id, expectedVersion: initialAddress.version }
          : {}),
        label: label.trim(),
        recipient: recipient.trim(),
        phone: normalizePhilippineMobile(phone)!,
        components,
        componentsSource,
        ...coordinate,
        confirmationSource,
        instructions,
        ...(!initialAddress ? { notes: nullable(notes) } : {}),
      };
      pendingSave.current = { method, key: crypto.randomUUID(), body: JSON.stringify(body) };
    }
    saveInFlight.current = true;
    setSaveState("saving");
    try {
      const response = await fetchImpl("/api/commerce/address", {
        method: pendingSave.current.method,
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": pendingSave.current.key },
        body: pendingSave.current.body,
      });
      const result = (await response.json()) as RpcResult<CustomerAddressView>;
      if (!response.ok || !result.ok) {
        setSaveState("error");
        setSaveError(safeSaveMessage(result.ok ? undefined : result.error));
        pendingSave.current = null;
        setSaveUncertain(false);
        return;
      }
      if (typeof result.value.id !== "string") throw new Error("Address result unavailable");
      pendingSave.current = null;
      setSaveUncertain(false);
      setSaveState("idle");
      onConfirmed?.(result.value.id);
    } catch {
      setSaveState("error");
      setSaveUncertain(true);
      setSaveError("Saving could not be confirmed. Retry the same address.");
    } finally {
      saveInFlight.current = false;
    }
  }

  return (
    <form
      onSubmit={save}
      className={compact ? "grid gap-3" : wizard ? "grid gap-0" : "grid gap-6"}
      aria-label="Delivery address editor"
      noValidate
    >
      {wizard && (
        <div className="border-b border-[var(--fm-border)] pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-primary-dark)]">
            Step {step} of 3
          </p>
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className="mt-1 text-2xl font-bold tracking-[-0.025em] text-[var(--fm-text)] focus:outline-none"
          >
            {step === 1
              ? "Find a delivery address"
              : step === 2
                ? "Address and recipient details"
                : "Delivery instructions"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--fm-text-muted)]">
            {step === 1
              ? "Search or use your current location, then place the pin at the exact delivery entrance."
              : step === 2
                ? "Tell us how to identify the destination and who will receive the delivery."
                : "Add the practical details that help the courier complete the handoff."}
          </p>
          <ol aria-label="Address progress" className="mt-6 grid grid-cols-3 gap-2">
            {[
              { label: "Location", icon: LocateFixed },
              { label: "Details", icon: UserRound },
              { label: "Instructions", icon: NotebookPen },
            ].map((item, index) => {
              const number = index + 1;
              const current = number === step;
              const complete = number < step;
              const Icon = item.icon;
              return (
                <li
                  key={item.label}
                  aria-current={current ? "step" : undefined}
                  className="min-w-0"
                >
                  <div
                    className={`h-1 rounded-full transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                      number <= step ? "bg-[var(--fm-primary-dark)]" : "bg-[var(--fm-border)]"
                    }`}
                  />
                  <span
                    className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${
                      number <= step ? "text-[var(--fm-text)]" : "text-[var(--fm-text-muted)]"
                    }`}
                  >
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full ${
                        complete
                          ? "bg-[var(--fm-primary-dark)] text-white"
                          : current
                            ? "bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)]"
                            : "bg-[var(--fm-surface-soft)]"
                      }`}
                    >
                      {complete ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : (
                        <Icon className="size-3" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <fieldset
        className="contents"
        disabled={purpose === "save" && (saveState === "saving" || saveUncertain)}
      >
        {wizard ? (
          <div
            hidden={step !== 1}
            data-address-location-layout="map-overlay"
            className="pt-6 [&[hidden]]:hidden"
          >
            <section aria-labelledby="pin-confirmation-heading" className="grid gap-3">
              <div>
                <h3 id="pin-confirmation-heading" className="text-lg font-semibold text-slate-950">
                  Confirm the exact entrance
                </h3>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Search, use your current location, or click the map. Drag the pin when the
                  suggested point is not exact.
                </p>
              </div>
              <div data-address-map-surface className="relative min-w-0">
                <GoogleMap
                  browserApiKey={browserApiKey}
                  mapId={mapId}
                  adapter={mapAdapter}
                  initialView={{ center: initialMapCenterRef.current, zoom: 14 }}
                  scene={{
                    draggablePin: {
                      position: coordinate ?? CEBU_CENTER,
                      label: coordinate
                        ? "Confirmed delivery entrance"
                        : "Move pin to delivery entrance",
                    },
                  }}
                  onPinMove={movePin}
                  onMapClick={movePin}
                  ariaLabel="Delivery address pin confirmation map"
                  className="h-[420px] w-full rounded-[var(--fm-radius-surface)] border shadow-[var(--fm-shadow-card)] sm:h-[500px]"
                  fallback={
                    <p className="text-sm text-slate-700">
                      You can still search or use your current location, then confirm the selected
                      address below.
                    </p>
                  }
                />
                <div className="absolute left-3 top-3 z-10 sm:left-4 sm:top-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      ref={searchToggleRef}
                      aria-label={
                        searchExpanded ? "Collapse address search" : "Search for an address"
                      }
                      aria-expanded={searchExpanded}
                      aria-controls="address-search-panel"
                      title={searchExpanded ? "Collapse address search" : "Search for an address"}
                      onClick={() => setSearchExpanded((current) => !current)}
                      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full border shadow-md transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                        searchExpanded
                          ? "border-[var(--fm-primary-dark)] bg-[var(--fm-primary-dark)] text-white"
                          : "border-white/80 bg-white/95 text-[var(--fm-text)] backdrop-blur-sm"
                      }`}
                    >
                      <Search className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Use current location"
                      title="Use current location"
                      onClick={useCurrentLocation}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/95 text-[var(--fm-text)] shadow-md backdrop-blur-sm transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                    >
                      <Navigation className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    id="address-search-panel"
                    aria-hidden={!searchExpanded}
                    inert={!searchExpanded}
                    className={`mt-2 w-[min(34rem,calc(100vw-8rem))] origin-top-left rounded-[var(--fm-radius-surface)] border border-white/80 bg-white/95 p-2 shadow-lg backdrop-blur-sm transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                      searchExpanded
                        ? "pointer-events-auto translate-y-0 opacity-100"
                        : "pointer-events-none -translate-y-1 opacity-0"
                    }`}
                  >
                    <div className="relative min-w-0">
                      <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                      />
                      <label htmlFor="address-search" className="sr-only">
                        Search for an address
                      </label>
                      <input
                        ref={searchInputRef}
                        id="address-search"
                        aria-describedby="address-search-help"
                        placeholder="Search for a delivery address"
                        autoComplete="off"
                        value={query}
                        onChange={(event) => {
                          coordinateActionGenerationRef.current += 1;
                          reverseAbortRef.current?.abort();
                          setQuery(event.currentTarget.value);
                        }}
                        className="min-h-11 w-full min-w-0 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white py-2 pl-10 pr-11 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                      />
                      <button
                        type="button"
                        aria-label="Collapse address search"
                        onClick={() => setSearchExpanded(false)}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--fm-radius-control)] text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p id="address-search-help" className="sr-only">
                      Search within the Philippines. Results are biased toward Cebu. Choose a
                      result, then move the pin to the exact entrance if needed.
                    </p>
                    {searchState === "searching" ? (
                      <p
                        role="status"
                        aria-live="polite"
                        className="px-2 pb-1 pt-2 text-xs text-slate-600"
                      >
                        Searching for addresses…
                      </p>
                    ) : null}
                    {searchError ? (
                      <p role="alert" className="px-2 pb-1 pt-2 text-xs text-red-700">
                        {searchError}
                      </p>
                    ) : null}
                    {locationError ? (
                      <p role="alert" className="px-2 pb-1 pt-2 text-xs text-red-700">
                        {locationError}
                      </p>
                    ) : null}
                    {candidates.length > 0 ? (
                      <ul
                        aria-label="Address search results"
                        className="mt-2 max-h-56 divide-y overflow-y-auto rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white shadow-lg"
                      >
                        <li
                          className="px-3 py-2 text-xs font-normal not-italic tracking-normal text-[#5e5e5e] whitespace-nowrap"
                          translate="no"
                        >
                          Google Maps
                        </li>
                        {candidates.map((candidate) => (
                          <li key={candidate.candidateKey}>
                            <button
                              type="button"
                              onClick={() => void chooseCandidate(candidate)}
                              className="w-full px-4 py-3 text-left text-sm hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                            >
                              {candidate.displayAddress}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {!searchExpanded && locationError ? (
                    <p
                      role="alert"
                      className="mt-2 w-[min(24rem,calc(100vw-5rem))] rounded-[var(--fm-radius-control)] border border-red-200 bg-white/95 p-3 text-xs text-red-700 shadow-lg backdrop-blur-sm"
                    >
                      {locationError}
                    </p>
                  ) : null}
                </div>
              </div>
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
                  Finding the closest fulfillment location…
                </p>
              ) : null}
              {serviceabilityState === "error" ? (
                <p role="alert" className="text-sm text-red-700">
                  A fulfillment location could not be assigned. Retry by selecting the address or
                  pin again.
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
                  <p className="font-semibold">{serviceabilityTitle(serviceability)}</p>
                  <p>{serviceabilityMessage(serviceability, purpose)}</p>
                </div>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="grid gap-6">
            <section aria-labelledby="address-search-heading" className="relative grid gap-3">
              <div className={compact ? "sr-only" : undefined}>
                <h3 id="address-search-heading" className="text-lg font-semibold text-slate-950">
                  Find the delivery address
                </h3>
                <p id="address-search-help" className="mt-1 text-sm text-slate-600">
                  Search within the Philippines. Results are biased toward Cebu and stay only in
                  this editor.
                </p>
              </div>
              {compact && compactHeading && (
                <h2 className="text-base font-bold">{compactHeading}</h2>
              )}
              {compact && !searchExpanded && (
                <button
                  type="button"
                  ref={searchToggleRef}
                  aria-expanded={searchExpanded}
                  aria-controls="address-search-panel"
                  onClick={() => setSearchExpanded(true)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-semibold hover:bg-[var(--fm-hover)]"
                >
                  <Map aria-hidden="true" className="size-4 shrink-0" />
                  Choose map
                </button>
              )}
              <div
                id="address-search-panel"
                hidden={compact && !searchExpanded}
                className="min-w-0 [&[hidden]]:hidden"
              >
                {compact ? (
                  <div className="relative">
                    <label htmlFor="address-search" className="sr-only">
                      Search for an address
                    </label>
                    <input
                      ref={searchInputRef}
                      id="address-search"
                      placeholder="Search address"
                      autoComplete="off"
                      value={query}
                      onChange={(event) => {
                        coordinateActionGenerationRef.current += 1;
                        reverseAbortRef.current?.abort();
                        setQuery(event.currentTarget.value);
                      }}
                      className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--fm-border)] bg-white py-2 pl-3 pr-11 text-sm focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                    />
                    <button
                      type="button"
                      ref={searchToggleRef}
                      aria-label="Close address search"
                      onClick={() => setSearchExpanded(false)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg hover:bg-[var(--fm-hover)] focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                ) : (
                  <TextField
                    id="address-search"
                    label="Search for an address"
                    placeholder="Enter a street or address"
                    description="Choose a result, then move the map pin to the exact entrance if needed."
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                      coordinateActionGenerationRef.current += 1;
                      reverseAbortRef.current?.abort();
                      setQuery(event.currentTarget.value);
                    }}
                  />
                )}
              </div>
              <div hidden={compact && !searchExpanded} className="grid gap-3 [&[hidden]]:hidden">
                {(!compact || searchExpanded) && searchState === "searching" ? (
                  <p role="status" aria-live="polite" className="text-sm text-slate-600">
                    Searching for addresses…
                  </p>
                ) : null}
                {(!compact || searchExpanded) && searchError ? (
                  <p role="alert" className="text-sm text-red-700">
                    {searchError}
                  </p>
                ) : null}
                {compact && candidates.length > 0 ? (
                  <ul
                    aria-label="Address search results"
                    className="overflow-hidden rounded-lg border border-[var(--fm-border)]"
                  >
                    <li
                      className="px-3 py-2 text-xs font-normal not-italic tracking-normal text-[#5e5e5e] whitespace-nowrap"
                      translate="no"
                    >
                      Google Maps
                    </li>
                    {candidates.map((candidate) => (
                      <li key={candidate.candidateKey}>
                        <button
                          type="button"
                          onClick={() => chooseCandidate(candidate)}
                          className="w-full border-b border-[var(--fm-border)] px-4 py-3 text-left text-sm hover:bg-[var(--fm-hover)] focus-visible:outline-2"
                        >
                          {candidate.displayAddress}
                        </button>
                      </li>
                    ))}
                    <li>
                      <button
                        type="button"
                        onClick={useCurrentLocation}
                        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-[var(--fm-hover)]"
                      >
                        <Navigation aria-hidden="true" className="size-4 shrink-0" />
                        Use current location
                      </button>
                    </li>
                  </ul>
                ) : candidates.length > 0 ? (
                  <ul aria-label="Address search results" className="divide-y rounded-lg border">
                    <li
                      className="px-3 py-2 text-xs font-normal not-italic tracking-normal text-[#5e5e5e] whitespace-nowrap"
                      translate="no"
                    >
                      Google Maps
                    </li>
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
              </div>
              {!compact && (
                <button
                  type="button"
                  onClick={useCurrentLocation}
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-4 text-sm font-semibold transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                >
                  <Navigation className="size-4" aria-hidden="true" />
                  Use current location
                </button>
              )}
              {locationError ? (
                <p role="alert" className="text-sm text-red-700">
                  {locationError}
                </p>
              ) : null}
            </section>

            {(!compact || coordinate) && (
              <section
                aria-labelledby={compact ? undefined : "pin-confirmation-heading"}
                aria-label={compact ? "Confirm the delivery pin" : undefined}
                className="grid gap-3"
              >
                {!compact && (
                  <div>
                    <h2
                      id="pin-confirmation-heading"
                      className="text-lg font-semibold text-slate-950"
                    >
                      Confirm the exact entrance
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      The confirmed pin determines the closest fulfillment location. Drag it when
                      the suggested point is not exact.
                    </p>
                  </div>
                )}
                <GoogleMap
                  browserApiKey={browserApiKey}
                  mapId={mapId}
                  adapter={mapAdapter}
                  initialView={{ center: initialMapCenterRef.current, zoom: 14 }}
                  scene={{
                    draggablePin: {
                      position: coordinate ?? CEBU_CENTER,
                      label: coordinate
                        ? "Confirmed delivery entrance"
                        : "Move pin to delivery entrance",
                    },
                  }}
                  onPinMove={movePin}
                  onMapClick={movePin}
                  ariaLabel="Delivery address pin confirmation map"
                  className={compact ? "h-52 rounded-lg border" : "min-h-72 rounded-xl border"}
                  fallback={
                    <p className="text-sm text-slate-700">
                      You can still choose a search result or use your current location, then
                      confirm the selected address below.
                    </p>
                  }
                />
                {selectedDisplayAddress ? (
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold">Selected address:</span>{" "}
                    {selectedDisplayAddress}
                  </p>
                ) : null}
                <p role="status" aria-live="polite" className="text-sm text-slate-600">
                  {coordinateAnnouncement}
                </p>
                {serviceabilityState === "checking" ? (
                  <p role="status" aria-live="polite" className="text-sm text-slate-600">
                    Finding the closest fulfillment location…
                  </p>
                ) : null}
                {serviceabilityState === "error" ? (
                  <p role="alert" className="text-sm text-red-700">
                    A fulfillment location could not be assigned. Retry by selecting the address or
                    pin again.
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
                    <p className="font-semibold">{serviceabilityTitle(serviceability)}</p>
                    <p className={compact && serviceability.serviceable ? "sr-only" : undefined}>
                      {serviceabilityMessage(serviceability, purpose)}
                    </p>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        )}
        {purpose === "serviceability" ? (
          <div className="grid gap-3">
            {compact ? (
              coordinate && (
                <p className="text-xs text-[var(--fm-text-muted)]">
                  Confirm full address at checkout.
                </p>
              )
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                This location is not a saved checkout address. Confirm your full delivery address at
                checkout.
              </p>
            )}
            {onServiceabilityConfirmed &&
            serviceability?.serviceable &&
            coordinate &&
            selectedDisplayAddress ? (
              <button
                type="button"
                disabled={saveState === "saving" || serviceabilityState !== "ready"}
                onClick={() => void confirmBrowsing()}
                className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
              >
                {saveState === "saving" ? "Confirming address…" : "Deliver here"}
              </button>
            ) : null}
            {saveError ? (
              <p role="alert" className="text-sm text-red-700">
                {saveError}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <section
              hidden={wizard && step !== 2}
              aria-labelledby="address-details-heading"
              className={`grid gap-4 [&[hidden]]:hidden ${wizard ? "pt-6" : ""}`}
            >
              {wizard && selectedDisplayAddress ? (
                <div className="flex items-start gap-3 rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[var(--fm-primary-dark)] shadow-sm">
                    <MapPin className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fm-text-muted)]">
                      Confirmed entrance
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--fm-text)]">
                      {selectedDisplayAddress}
                    </p>
                  </div>
                </div>
              ) : null}
              <h3 id="address-details-heading" className="text-lg font-semibold text-slate-950">
                Contact and address
              </h3>
              {providerResolvedComponents ? (
                <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  Search-result address fields are provider-resolved when saved. Move the pin to
                  establish a first-party location before changing them; add unit, entrance,
                  landmark, and courier guidance under Delivery instructions.
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
                <div className="grid gap-3">
                  {savedPhones.length ? (
                    <label className="grid gap-1.5 text-sm font-medium text-slate-950">
                      Use a saved phone number
                      <select
                        aria-label="Choose a saved phone number"
                        value={
                          savedPhones.includes(normalizePhilippineMobile(phone) ?? "")
                            ? (normalizePhilippineMobile(phone) ?? "")
                            : "new"
                        }
                        onChange={(event) =>
                          setPhone(
                            event.currentTarget.value === "new"
                              ? ""
                              : formatPhilippineMobileInput(event.currentTarget.value),
                          )
                        }
                        className="min-h-11 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--fm-focus)]"
                      >
                        {savedPhones.map((savedPhone) => (
                          <option key={savedPhone} value={savedPhone}>
                            {formatPhilippineMobileInput(savedPhone)}
                          </option>
                        ))}
                        <option value="new">Use a different number</option>
                      </select>
                    </label>
                  ) : null}
                  <TextField
                    id="address-phone"
                    label="Phone number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+63 917 123 4567"
                    description="Philippine mobile format. Shared with the courier for this delivery."
                    value={phone}
                    error={fieldErrors.phone}
                    onChange={(event) =>
                      setPhone(formatPhilippineMobileInput(event.currentTarget.value))
                    }
                    onBlur={(event) =>
                      setPhone(formatPhilippineMobileInput(event.currentTarget.value))
                    }
                  />
                </div>
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

            <section
              hidden={wizard && step !== 3}
              aria-labelledby="delivery-instructions-heading"
              className={`grid gap-4 [&[hidden]]:hidden ${wizard ? "pt-6" : ""}`}
            >
              {wizard && selectedDisplayAddress ? (
                <div className="flex items-start gap-3 rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[var(--fm-primary-dark)] shadow-sm">
                    <MapPin className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fm-text-muted)]">
                      Delivering to
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--fm-text)]">
                      {selectedDisplayAddress}
                    </p>
                    <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
                      {recipient || "Recipient"} · {phone || "Phone number"}
                    </p>
                  </div>
                </div>
              ) : null}
              <div>
                <h3
                  id="delivery-instructions-heading"
                  className="text-lg font-semibold text-slate-950"
                >
                  Help the courier find you
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Add only details the external courier needs for this destination.
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
            {wizard && (
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--fm-border)] pt-5">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSaveError("");
                      setStep(step - 1);
                    }}
                    className="inline-flex min-h-12 items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-5 text-sm font-semibold transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back
                  </button>
                )}
                {step < 3 && (
                  <button
                    type="submit"
                    className="ml-auto inline-flex min-h-12 items-center gap-2 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-5 text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                  >
                    Continue
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                )}
                {step === 3 && !saveUncertain ? (
                  <button
                    type="submit"
                    disabled={saveState === "saving" || !coordinate || !confirmationSource}
                    className="ml-auto inline-flex min-h-12 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-5 text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                  >
                    {saveState === "saving"
                      ? "Saving address…"
                      : serviceability?.serviceable === false
                        ? "Save address"
                        : initialAddress
                          ? "Update confirmed address"
                          : "Save and use this address"}
                  </button>
                ) : null}
              </div>
            )}
            {!saveUncertain && !wizard ? (
              <button
                type="submit"
                disabled={saveState === "saving" || !coordinate || !confirmationSource}
                className="flex items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-5 text-sm font-bold text-white transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                {saveState === "saving"
                  ? "Saving address…"
                  : serviceability?.serviceable === false
                    ? "Save confirmed address"
                    : initialAddress
                      ? "Update confirmed address"
                      : "Save confirmed address"}
              </button>
            ) : null}
          </>
        )}
      </fieldset>
      {saveUncertain ? (
        <button
          type="submit"
          disabled={saveState === "saving"}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white"
        >
          {saveState === "saving" ? "Saving address…" : "Retry saving address"}
        </button>
      ) : null}
    </form>
  );
}
