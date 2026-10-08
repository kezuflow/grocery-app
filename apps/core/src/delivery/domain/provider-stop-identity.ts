import type { Coordinate } from "@freshmarkets/contracts";

/** Accept centimetre-scale decimal serialization rounding only.
 * Callers also require the unchanged address and, when supplied, contact.
 */
export function providerCoordinatesMatch(left: Coordinate, right: Coordinate): boolean {
  return (
    Number.isFinite(left.latitude) &&
    Number.isFinite(left.longitude) &&
    Number.isFinite(right.latitude) &&
    Number.isFinite(right.longitude) &&
    Math.abs(left.latitude - right.latitude) <= 0.0000001 &&
    Math.abs(left.longitude - right.longitude) <= 0.0000001
  );
}
