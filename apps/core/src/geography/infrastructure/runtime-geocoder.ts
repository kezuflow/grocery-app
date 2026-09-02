import type { GeocoderPort } from "../ports/geocoder";
import { GeocoderError, MapboxGeocoder } from "./mapbox-geocoder";

export function buildGeocoderPort(
  environment: { MAPBOX_ACCESS_TOKEN?: string },
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
): GeocoderPort {
  if (environment.MAPBOX_ACCESS_TOKEN)
    return new MapboxGeocoder(environment.MAPBOX_ACCESS_TOKEN, fetchImpl);
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
