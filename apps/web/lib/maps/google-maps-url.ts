import type { Coordinate } from "@freshmarkets/contracts";

const GOOGLE_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/";

export class GoogleMapsCoordinateValidationError extends Error {
  constructor() {
    super("Google Maps navigation requires a valid coordinate");
    this.name = "GoogleMapsCoordinateValidationError";
  }
}

function validCoordinate(coordinate: Coordinate): boolean {
  if (coordinate == null) return false;

  return (
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  );
}

export function googleMapsNavigationUrl(coordinate: Coordinate): string {
  if (!validCoordinate(coordinate)) throw new GoogleMapsCoordinateValidationError();

  const url = new URL(GOOGLE_MAPS_DIRECTIONS_URL);
  url.search = new URLSearchParams([
    ["api", "1"],
    ["destination", `${coordinate.latitude},${coordinate.longitude}`],
    ["travelmode", "driving"],
    ["dir_action", "navigate"],
  ]).toString();
  return url.toString();
}
