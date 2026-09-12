import type { RequestMeta, RpcResult } from "./common";
import type { AddressSearchCandidate, Coordinate } from "./geography";

/** Temporary editor suggestion. Resolve before using as a coordinate. */
export type AddressPrediction = { candidateKey: string; displayAddress: string };
export type AddressAutocompleteRequest = RequestMeta & {
  query: string;
  proximity?: Coordinate;
  sessionToken: string;
};
export type AddressPredictionRequest = RequestMeta & {
  candidateKey: string;
  sessionToken: string;
};
export interface AddressAutocompleteService {
  autocompleteAddress(
    input: AddressAutocompleteRequest,
  ): Promise<RpcResult<readonly AddressPrediction[]>>;
  resolveAddressPrediction(
    input: AddressPredictionRequest,
  ): Promise<RpcResult<AddressSearchCandidate>>;
}
