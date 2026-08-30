import type { RequestMeta } from "./common";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type AddressComponents = {
  addressLine1: string;
  addressLine2: string | null;
  barangay: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
};

export type CoordinateConfirmationSource = "GEOCODER" | "USER_PIN" | "DEVICE_LOCATION";

/** Provenance of structured text, independent from the final coordinate confirmation source. */
export type AddressComponentsSource = "TEMPORARY_GEOCODER" | "FIRST_PARTY" | "SAVED_ADDRESS";

export type AddressSearchRequest = RequestMeta & {
  query: string;
  proximity?: Coordinate;
};

export type AddressSearchCandidate = {
  candidateKey: string;
  displayAddress: string;
  coordinate: Coordinate;
  components: AddressComponents;
  accuracy: string | null;
};

export type DeliveryInstructions = {
  buildingUnit: string | null;
  landmark: string | null;
  gateGuard: string | null;
  deliveryNote: string | null;
  recipientInstruction: string | null;
};

export type ServiceabilityFailureReason =
  | "INVALID_COORDINATES"
  | "OUTSIDE_SERVICE_AREA"
  | "OUTSIDE_DELIVERY_ZONE"
  | "NO_ELIGIBLE_LOCATION";

export type ServiceabilityRequest = RequestMeta &
  Coordinate & {
    marketCode?: string;
    addressComponents?: Readonly<Record<string, string>>;
    previousResolution?: {
      serviceAreaCode: string;
      serviceAreaPolygonVersion: number;
      deliveryZoneCode: string | null;
      deliveryZonePolygonVersion: number | null;
    };
  };

export type ServiceabilityMarket = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
};

export type ServiceabilityArea = {
  code: string;
  name: string;
  polygonVersion: number;
};

export type ServiceabilityZone = {
  code: string;
  name: string;
  polygonVersion: number;
};

export type ServiceabilityResult = {
  serviceable: boolean;
  reason: ServiceabilityFailureReason | null;
  coordinate: Coordinate;
  market: ServiceabilityMarket | null;
  serviceArea: ServiceabilityArea | null;
  deliveryZone: ServiceabilityZone | null;
  fulfillmentEligibility: {
    eligible: boolean;
    candidateCount: number;
  };
  resolutionChanged: boolean;
  evaluatedAt: string;
};
