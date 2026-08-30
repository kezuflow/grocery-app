import type { Coordinate, DeliveryMapPin } from "@freshmarkets/contracts";

export type DragBounds = {
  firstCorner: Coordinate;
  secondCorner: Coordinate;
};

function validCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  );
}

export function pinsInsideBounds(
  pins: ReadonlyArray<DeliveryMapPin>,
  bounds: DragBounds,
): DeliveryMapPin[] {
  const minimumLatitude = Math.min(bounds.firstCorner.latitude, bounds.secondCorner.latitude);
  const maximumLatitude = Math.max(bounds.firstCorner.latitude, bounds.secondCorner.latitude);
  const minimumLongitude = Math.min(bounds.firstCorner.longitude, bounds.secondCorner.longitude);
  const maximumLongitude = Math.max(bounds.firstCorner.longitude, bounds.secondCorner.longitude);

  return pins.filter(({ coordinate, selection }) => {
    if (!selection.selectable || coordinate === null || !validCoordinate(coordinate)) return false;
    return (
      coordinate.latitude >= minimumLatitude &&
      coordinate.latitude <= maximumLatitude &&
      coordinate.longitude >= minimumLongitude &&
      coordinate.longitude <= maximumLongitude
    );
  });
}
