import { observeProviderOperation, defaultProviderTelemetry } from "./provider-telemetry";
import { z } from "@freshmarkets/validation";
import type {
  AddressAutocompleteRequest,
  AddressPredictionRequest,
  AddressSearchCandidate,
} from "@freshmarkets/contracts";
import { GeocoderError } from "./geocoder-error";

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const sessionToken = z.string().uuid();
export const autocompleteSchema = z.object({
  requestId: z.string().min(1),
  query: z.string().trim().min(2).max(200),
  proximity: coordinateSchema.optional(),
  sessionToken,
});
export const predictionSchema = z.object({
  requestId: z.string().min(1),
  candidateKey: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[A-Za-z0-9_-]+$/),
  sessionToken,
});
const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z.object({
          placeId: z
            .string()
            .min(1)
            .max(300)
            .regex(/^[A-Za-z0-9_-]+$/),
          text: z.object({ text: z.string().min(1) }),
        }),
      }),
    )
    .max(5)
    .default([]),
});
const detailsSchema = z.object({
  id: z.string(),
  formattedAddress: z.string().min(1),
  displayName: z.object({ text: z.string() }).optional(),
  location: coordinateSchema,
  addressComponents: z.array(
    z.object({
      longText: z.string(),
      shortText: z.string().optional(),
      types: z.array(z.string()),
    }),
  ),
});

export class GooglePlaces {
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  autocomplete(input: AddressAutocompleteRequest) {
    return observeProviderOperation("GOOGLE_PLACES_AUTOCOMPLETE", defaultProviderTelemetry, () =>
      this.fetchPredictions(input),
    );
  }
  resolve(input: AddressPredictionRequest) {
    return observeProviderOperation("GOOGLE_PLACES_DETAILS", defaultProviderTelemetry, () =>
      this.fetchDetails(input),
    );
  }
  private async fetchPredictions(input: AddressAutocompleteRequest) {
    const payload = await this.request("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify({
        input: input.query,
        sessionToken: input.sessionToken,
        includedRegionCodes: ["ph"],
        languageCode: "en",
        regionCode: "ph",
        locationBias: {
          circle: {
            center: input.proximity ?? { latitude: 10.3157, longitude: 123.8854 },
            radius: 50000,
          },
        },
      }),
    });
    const parsed = suggestionsSchema.safeParse(payload);
    if (!parsed.success) throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    return parsed.data.suggestions.map(({ placePrediction }) => ({
      candidateKey: placePrediction.placeId,
      displayAddress: placePrediction.text.text,
    }));
  }

  private async fetchDetails(input: AddressPredictionRequest): Promise<AddressSearchCandidate> {
    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(input.candidateKey)}`,
    );
    url.searchParams.set("sessionToken", input.sessionToken);
    url.searchParams.set("languageCode", "en");
    const payload = await this.request(url, {
      method: "GET",
      headers: { "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents,displayName" },
    });
    const parsed = detailsSchema.safeParse(payload);
    if (!parsed.success || parsed.data.id !== input.candidateKey)
      throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
    const place = parsed.data;
    const component = (type: string, short = false) => {
      const value = place.addressComponents.find((part) => part.types.includes(type));
      return (short ? value?.shortText : value?.longText) ?? null;
    };
    const countryCode = component("country", true);
    if (countryCode !== "PH") throw new GeocoderError("GEOCODER_NO_RESULTS");
    return {
      candidateKey: place.id,
      displayAddress: place.displayName?.text
        ? `${place.displayName.text}, ${place.formattedAddress}`
        : place.formattedAddress,
      coordinate: place.location,
      accuracy: null,
      components: {
        addressLine1:
          [component("street_number"), component("route")].filter(Boolean).join(" ") ||
          component("premise") ||
          place.displayName?.text ||
          place.formattedAddress.split(",")[0] ||
          place.formattedAddress,
        addressLine2: component("subpremise"),
        barangay:
          component("sublocality_level_1") ?? component("sublocality") ?? component("neighborhood"),
        city:
          component("locality") ??
          component("postal_town") ??
          component("administrative_area_level_2") ??
          "",
        region: component("administrative_area_level_1"),
        postalCode: component("postal_code"),
        countryCode,
      },
    };
  }

  private async request(url: string | URL, init: RequestInit): Promise<unknown> {
    if (!this.key) throw new GeocoderError("GEOCODER_UNCONFIGURED");
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...init.headers,
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.key,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403)
        throw new GeocoderError("GEOCODER_UNAUTHORIZED");
      if (response.status === 429) throw new GeocoderError("GEOCODER_RATE_LIMITED");
      if (response.status === 404) throw new GeocoderError("GEOCODER_NO_RESULTS");
      if (!response.ok) throw new GeocoderError("GEOCODER_UNAVAILABLE");
      try {
        return await response.json();
      } catch {
        throw new GeocoderError("GEOCODER_INVALID_RESPONSE");
      }
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new GeocoderError("GEOCODER_TIMEOUT");
      throw new GeocoderError("GEOCODER_UNAVAILABLE");
    }
  }
}
