import type {
  AddressComponents,
  AddressSearchCandidate,
  Coordinate,
} from "@freshmarkets/contracts";
import type { GeocoderPort, GeocoderSearchInput, PermanentGeocode } from "../ports/geocoder";
import {
  defaultProviderTelemetry,
  observeProviderOperation,
  type ProviderTelemetryDependencies,
} from "./provider-telemetry";

const MAPBOX_GEOCODING_BASE_URL = "https://api.mapbox.com/search/geocode/v6";
const CEBU_PROXIMITY: Coordinate = { latitude: 10.3157, longitude: 123.8854 };
const SEARCH_RESULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;

export type GeocoderErrorCode =
  | "GEOCODER_UNCONFIGURED"
  | "GEOCODER_INVALID_REQUEST"
  | "GEOCODER_UNAUTHORIZED"
  | "GEOCODER_RATE_LIMITED"
  | "GEOCODER_TIMEOUT"
  | "GEOCODER_UNAVAILABLE"
  | "GEOCODER_INVALID_RESPONSE"
  | "GEOCODER_NO_RESULTS";

export class GeocoderError extends Error {
  constructor(readonly code: GeocoderErrorCode) {
    super(code);
    this.name = "GeocoderError";
  }
}

type MapboxContextItem = {
  name?: unknown;
  country_code?: unknown;
};

type MapboxFeature = {
  id?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
  properties?: {
    mapbox_id?: unknown;
    feature_type?: unknown;
    full_address?: unknown;
    name?: unknown;
    coordinates?: { accuracy?: unknown };
    context?: {
      address?: MapboxContextItem;
      secondary_address?: MapboxContextItem;
      neighborhood?: MapboxContextItem;
      locality?: MapboxContextItem;
      place?: MapboxContextItem;
      region?: MapboxContextItem;
      postcode?: MapboxContextItem;
      country?: MapboxContextItem;
    };
  };
};

type MappedFeature = AddressSearchCandidate & {
  providerReference: string;
};

export class MapboxGeocoder implements GeocoderPort {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    private readonly telemetry: ProviderTelemetryDependencies = defaultProviderTelemetry,
  ) {}

  async search(input: GeocoderSearchInput): Promise<ReadonlyArray<AddressSearchCandidate>> {
    return observeProviderOperation("MAPBOX_GEOCODER_SEARCH", this.telemetry, async () => {
      this.requireConfigured();
      const query = input.query.trim();
      if (!query) throw new GeocoderError("GEOCODER_INVALID_REQUEST");
      const proximity = input.proximity ?? CEBU_PROXIMITY;
      validateCoordinate(proximity);

      const url = new URL(`${MAPBOX_GEOCODING_BASE_URL}/forward`);
      url.searchParams.set("q", query);
      url.searchParams.set("country", "PH");
      url.searchParams.set("proximity", `${proximity.longitude},${proximity.latitude}`);
      url.searchParams.set("limit", String(SEARCH_RESULT_LIMIT));
      url.searchParams.set("access_token", this.accessToken);

      const features = await this.requestFeatures(url);
      return features.flatMap((feature) => {
        const mapped = mapFeature(feature);
        if (!mapped) return [];
        const { providerReference: _providerReference, ...candidate } = mapped;
        return [candidate];
      });
    });
  }

  async reversePermanent(input: { coordinate: Coordinate }): Promise<PermanentGeocode> {
    return observeProviderOperation(
      "MAPBOX_GEOCODER_REVERSE_PERMANENT",
      this.telemetry,
      async () => {
        this.requireConfigured();
        validateCoordinate(input.coordinate);

        const url = new URL(`${MAPBOX_GEOCODING_BASE_URL}/reverse`);
        url.searchParams.set("longitude", String(input.coordinate.longitude));
        url.searchParams.set("latitude", String(input.coordinate.latitude));
        url.searchParams.set("country", "PH");
        url.searchParams.set("permanent", "true");
        url.searchParams.set("access_token", this.accessToken);

        const features = await this.requestFeatures(url);
        for (const feature of features) {
          const mapped = mapFeature(feature);
          if (mapped)
            return {
              provider: "MAPBOX",
              providerReference: mapped.providerReference,
              displayAddress: mapped.displayAddress,
              coordinate: mapped.coordinate,
              components: mapped.components,
              accuracy: mapped.accuracy,
            };
        }
        throw new GeocoderError("GEOCODER_NO_RESULTS");
      },
    );
  }

  private requireConfigured(): void {
    if (!this.accessToken) throw new GeocoderError("GEOCODER_UNCONFIGURED");
  }

  private async requestFeatures(url: URL): Promise<ReadonlyArray<MapboxFeature>> {
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
    if (!isRecord(payload) || !Array.isArray(payload.features))
      throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    return payload.features.filter(isRecord) as ReadonlyArray<MapboxFeature>;
  }
}

function mapFeature(feature: MapboxFeature): MappedFeature | null {
  const featureType = nonEmptyString(feature.properties?.feature_type);
  if (featureType !== "address" && featureType !== "street") return null;
  const providerReference = nonEmptyString(feature.properties?.mapbox_id ?? feature.id);
  const displayAddress = nonEmptyString(feature.properties?.full_address);
  const coordinates = feature.geometry?.coordinates;
  if (
    feature.geometry?.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !validCoordinateValues(coordinates[1], coordinates[0]) ||
    !providerReference ||
    !displayAddress
  )
    return null;

  const context = feature.properties?.context;
  const featureName = nonEmptyString(feature.properties?.name);
  const addressLine1 = contextName(context?.address) ?? featureName;
  const city = contextName(context?.place);
  const countryCode = nonEmptyString(context?.country?.country_code)?.toUpperCase() ?? null;
  if (!addressLine1 || !city || !countryCode) return null;

  const components: AddressComponents = {
    addressLine1,
    addressLine2: contextName(context?.secondary_address),
    barangay: contextName(context?.neighborhood) ?? contextName(context?.locality),
    city,
    region: contextName(context?.region),
    postalCode: contextName(context?.postcode),
    countryCode,
  };
  return {
    candidateKey: providerReference,
    providerReference,
    displayAddress,
    coordinate: { latitude: coordinates[1], longitude: coordinates[0] },
    components,
    accuracy: nonEmptyString(feature.properties?.coordinates?.accuracy),
  };
}

function contextName(item: MapboxContextItem | undefined): string | null {
  return nonEmptyString(item?.name);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (isRecord(error) && error.name === "TimeoutError")
  );
}
