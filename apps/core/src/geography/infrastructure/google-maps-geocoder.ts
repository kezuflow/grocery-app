import type { AddressSearchCandidate, Coordinate } from "@freshmarkets/contracts";
import type { GeocoderPort, GeocoderSearchInput, PermanentGeocode } from "../ports/geocoder";
import { GeocoderError } from "./geocoder-error";
import {
  defaultProviderTelemetry,
  observeProviderOperation,
  type ProviderTelemetryDependencies,
} from "./provider-telemetry";

const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const CEBU_PROXIMITY: Coordinate = { latitude: 10.3157, longitude: 123.8854 };
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const SEARCH_RESULT_LIMIT = 5;

type GoogleAddressComponent = Readonly<{
  long_name?: unknown;
  short_name?: unknown;
  types?: unknown;
}>;

type GoogleGeocodingResult = Readonly<{
  place_id?: unknown;
  formatted_address?: unknown;
  address_components?: unknown;
  geometry?: {
    location?: { lat?: unknown; lng?: unknown };
    location_type?: unknown;
  };
}>;

type MappedResult = AddressSearchCandidate & { providerReference: string };

export { GeocoderError } from "./geocoder-error";

export class GoogleMapsGeocoder implements GeocoderPort {
  constructor(
    private readonly serverApiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    private readonly telemetry: ProviderTelemetryDependencies = defaultProviderTelemetry,
  ) {}

  async search(input: GeocoderSearchInput): Promise<ReadonlyArray<AddressSearchCandidate>> {
    return observeProviderOperation("GOOGLE_MAPS_GEOCODER_SEARCH", this.telemetry, async () => {
      this.requireConfigured();
      const query = input.query.trim();
      if (!query) throw new GeocoderError("GEOCODER_INVALID_REQUEST");
      const proximity = input.proximity ?? CEBU_PROXIMITY;
      validateCoordinate(proximity);
      const url = this.buildUrl();
      url.searchParams.set("address", query);
      url.searchParams.set("components", "country:PH");
      url.searchParams.set("region", "ph");
      url.searchParams.set("bounds", boundsAround(proximity));
      return (await this.requestResults(url)).slice(0, SEARCH_RESULT_LIMIT).flatMap((result) => {
        const mapped = mapResult(result);
        if (!mapped) return [];
        const { providerReference: _providerReference, ...candidate } = mapped;
        return [candidate];
      });
    });
  }

  async reverseTemporary(input: { coordinate: Coordinate }): Promise<AddressSearchCandidate> {
    return observeProviderOperation(
      "GOOGLE_MAPS_GEOCODER_REVERSE_TEMPORARY",
      this.telemetry,
      async () => {
        const mapped = await this.reverse(input.coordinate);
        const { providerReference: _providerReference, ...candidate } = mapped;
        return candidate;
      },
    );
  }

  async reversePermanent(input: { coordinate: Coordinate }): Promise<PermanentGeocode> {
    return observeProviderOperation(
      "GOOGLE_MAPS_GEOCODER_REVERSE_PERMANENT",
      this.telemetry,
      async () => {
        const mapped = await this.reverse(input.coordinate);
        return {
          provider: "GOOGLE_MAPS",
          providerReference: mapped.providerReference,
          displayAddress: mapped.displayAddress,
          coordinate: mapped.coordinate,
          components: mapped.components,
          accuracy: mapped.accuracy,
        };
      },
    );
  }

  private buildUrl(): URL {
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("key", this.serverApiKey);
    return url;
  }

  private requireConfigured(): void {
    if (!this.serverApiKey) throw new GeocoderError("GEOCODER_UNCONFIGURED");
  }

  private async reverse(coordinate: Coordinate): Promise<MappedResult> {
    this.requireConfigured();
    validateCoordinate(coordinate);
    const url = this.buildUrl();
    url.searchParams.set("latlng", `${coordinate.latitude},${coordinate.longitude}`);
    url.searchParams.set("region", "ph");
    for (const result of await this.requestResults(url)) {
      const mapped = mapResult(result);
      if (mapped) return mapped;
    }
    throw new GeocoderError("GEOCODER_NO_RESULTS");
  }

  private async requestResults(url: URL): Promise<ReadonlyArray<GoogleGeocodingResult>> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new GeocoderError("GEOCODER_TIMEOUT");
      throw new GeocoderError("GEOCODER_UNAVAILABLE");
    }
    if (response.status === 401 || response.status === 403)
      throw new GeocoderError("GEOCODER_UNAUTHORIZED");
    if (response.status === 429) throw new GeocoderError("GEOCODER_RATE_LIMITED");
    if (!response.ok) throw new GeocoderError("GEOCODER_UNAVAILABLE");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    }
    if (!isRecord(payload) || typeof payload.status !== "string" || !Array.isArray(payload.results))
      throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    if (payload.status === "ZERO_RESULTS") return [];
    if (payload.status === "REQUEST_DENIED") throw new GeocoderError("GEOCODER_UNAUTHORIZED");
    if (payload.status === "OVER_QUERY_LIMIT" || payload.status === "OVER_DAILY_LIMIT")
      throw new GeocoderError("GEOCODER_RATE_LIMITED");
    if (payload.status === "INVALID_REQUEST") throw new GeocoderError("GEOCODER_INVALID_REQUEST");
    if (payload.status === "UNKNOWN_ERROR") throw new GeocoderError("GEOCODER_UNAVAILABLE");
    if (payload.status !== "OK") throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    return payload.results.filter(isRecord) as ReadonlyArray<GoogleGeocodingResult>;
  }
}

function mapResult(result: GoogleGeocodingResult): MappedResult | null {
  const providerReference = nonEmptyString(result.place_id);
  const displayAddress = nonEmptyString(result.formatted_address);
  const latitude = result.geometry?.location?.lat;
  const longitude = result.geometry?.location?.lng;
  const components = Array.isArray(result.address_components)
    ? (result.address_components.filter(isRecord) as GoogleAddressComponent[])
    : [];
  const countryCode = component(components, "country", true)?.toUpperCase() ?? null;
  const city =
    component(components, "locality") ??
    component(components, "postal_town") ??
    component(components, "administrative_area_level_2");
  const route = component(components, "route");
  const streetNumber = component(components, "street_number");
  const addressLine1 =
    [streetNumber, route].filter(Boolean).join(" ") ||
    component(components, "premise") ||
    component(components, "establishment") ||
    displayAddress?.split(",")[0]?.trim() ||
    null;
  if (
    !providerReference ||
    !displayAddress ||
    !validCoordinateValues(latitude, longitude) ||
    !addressLine1 ||
    !city ||
    !countryCode
  )
    return null;
  return {
    candidateKey: providerReference,
    providerReference,
    displayAddress,
    coordinate: { latitude: latitude as number, longitude: longitude as number },
    components: {
      addressLine1,
      addressLine2: component(components, "subpremise"),
      barangay:
        component(components, "sublocality_level_1") ??
        component(components, "sublocality") ??
        component(components, "neighborhood"),
      city,
      region: component(components, "administrative_area_level_1"),
      postalCode: component(components, "postal_code"),
      countryCode,
    },
    accuracy: nonEmptyString(result.geometry?.location_type),
  };
}

function component(
  components: readonly GoogleAddressComponent[],
  type: string,
  short = false,
): string | null {
  const item = components.find(
    (candidate) => Array.isArray(candidate.types) && candidate.types.includes(type),
  );
  return nonEmptyString(short ? item?.short_name : item?.long_name);
}

function boundsAround({ latitude, longitude }: Coordinate): string {
  const delta = 0.5;
  return `${Math.max(-90, latitude - delta)},${Math.max(-180, longitude - delta)}|${Math.min(90, latitude + delta)},${Math.min(180, longitude + delta)}`;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function validateCoordinate(coordinate: Coordinate): void {
  if (!validCoordinateValues(coordinate.latitude, coordinate.longitude))
    throw new GeocoderError("GEOCODER_INVALID_REQUEST");
}

function validCoordinateValues(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (isRecord(error) && error.name === "TimeoutError")
  );
}
