import type { GeocoderPort } from "../ports/geocoder";
import { GeocoderError } from "./geocoder-error";
import { GoogleMapsGeocoder } from "./google-maps-geocoder";

export function buildGeocoderPort(
  environment: { GOOGLE_MAPS_SERVER_KEY?: string },
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): GeocoderPort {
  if (environment.GOOGLE_MAPS_SERVER_KEY)
    return new GoogleMapsGeocoder(environment.GOOGLE_MAPS_SERVER_KEY, fetchImpl);
  return {
    async search() {
      throw new GeocoderError("GEOCODER_UNCONFIGURED");
    },
    async reverseTemporary() {
      throw new GeocoderError("GEOCODER_UNCONFIGURED");
    },
    async reversePermanent() {
      throw new GeocoderError("GEOCODER_UNCONFIGURED");
    },
  };
}
