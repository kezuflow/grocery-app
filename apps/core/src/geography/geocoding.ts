import type { Coordinate } from "@freshmarkets/contracts";

export type GeocodeCandidate = Coordinate & {
  providerReference: string;
  formattedAddress: string;
  addressComponents: Readonly<Record<string, string>>;
};

export type GeocoderPort = {
  search(input: { query: string; marketCode: string }): Promise<ReadonlyArray<GeocodeCandidate>>;
};

export type CoordinateConfirmation =
  | { source: "GEOCODER"; providerReference: string; userConfirmedAt: Date }
  | { source: "USER_PIN"; userConfirmedAt: Date };

export function coordinatesConfirmed(confirmation: CoordinateConfirmation | null): boolean {
  return Boolean(
    confirmation?.userConfirmedAt && Number.isFinite(confirmation.userConfirmedAt.getTime()),
  );
}
