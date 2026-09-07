import type {
  AddressComponents,
  AddressComponentsSource,
  CoordinateConfirmationSource,
} from "@freshmarkets/contracts";
import type { GeocoderPort } from "../ports/geocoder";

export type FinalizedConfirmation = {
  components: AddressComponents;
  provider: string | null;
  providerReference: string | null;
  source: CoordinateConfirmationSource;
  confirmedAt: number;
};

/** Temporary provider text is never a durable address, even after the user moves its pin. */
export async function finalizeAddressConfirmation(
  geocoder: GeocoderPort,
  input: {
    latitude: number;
    longitude: number;
    components: AddressComponents;
    componentsSource: AddressComponentsSource;
    persistedProvider?: string | null;
    locationChanged?: boolean;
    source: CoordinateConfirmationSource;
    confirmedAt: number;
  },
): Promise<FinalizedConfirmation> {
  const requiresPermanentComponents =
    input.componentsSource === "TEMPORARY_GEOCODER" ||
    (input.componentsSource === "SAVED_ADDRESS"
      ? input.locationChanged === true &&
        (input.source === "GEOCODER" ||
          (input.persistedProvider !== null && input.persistedProvider !== undefined))
      : input.source === "GEOCODER");
  if (!requiresPermanentComponents)
    return {
      components: input.components,
      provider: null,
      providerReference: null,
      source: input.source,
      confirmedAt: input.confirmedAt,
    };
  const permanent = await geocoder.reversePermanent({
    coordinate: { latitude: input.latitude, longitude: input.longitude },
  });
  return {
    components: permanent.components,
    provider: permanent.provider,
    providerReference: permanent.providerReference,
    source: input.source,
    confirmedAt: input.confirmedAt,
  };
}
