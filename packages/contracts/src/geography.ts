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
