import type {
  AddressComponents,
  AddressSearchCandidate,
  Coordinate,
} from "@freshmarkets/contracts";

export type GeocoderSearchInput = {
  query: string;
  proximity?: Coordinate;
};

export type PermanentGeocode = {
  provider: string;
  providerReference: string;
  displayAddress: string;
  coordinate: Coordinate;
  components: AddressComponents;
  accuracy: string | null;
};

export interface GeocoderPort {
  search(input: GeocoderSearchInput): Promise<ReadonlyArray<AddressSearchCandidate>>;
  reversePermanent(input: { coordinate: Coordinate }): Promise<PermanentGeocode>;
}
