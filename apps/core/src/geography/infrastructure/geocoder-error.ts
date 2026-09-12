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
