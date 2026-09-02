export type Position = readonly [number, number];
export type Polygon = readonly (readonly Position[])[];

const EPSILON = 1e-10;

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

export function parsePolygonGeoJson(value: string): Polygon | null {
  try {
    const parsed = JSON.parse(value) as {
      type?: string;
      geometry?: { type?: string; coordinates?: unknown };
      coordinates?: unknown;
    };
    const geometry = parsed.type === "Feature" ? parsed.geometry : parsed;
    if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return null;
    const rings = geometry.coordinates.filter((ring): ring is unknown[] => Array.isArray(ring));
    if (!rings.length) return null;
    const polygon = rings.map((ring) => ring.filter(isPosition));
    if (polygon.some((ring) => ring.length < 4)) return null;
    return polygon;
  } catch {
    return null;
  }
}

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > EPSILON) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  );
}

function pointInRing(point: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index];
    const prior = ring[previous];
    if (pointOnSegment(point, prior, current)) return true;
    const intersects =
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] <
        ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Position, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

export function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Exact deterministic great-circle distance used only for location ownership. */
export function haversineDistanceMeters(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const destinationLatitude = radians(destination.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function closestLocation<T extends { id: string; latitude: number; longitude: number }>(
  coordinate: { latitude: number; longitude: number },
  candidates: readonly T[],
): T | null {
  return sortLocationsByDistance(coordinate, candidates)[0] ?? null;
}

export function sortLocationsByDistance<
  T extends { id: string; latitude: number; longitude: number },
>(coordinate: { latitude: number; longitude: number }, candidates: readonly T[]): T[] {
  return [...candidates].sort((left, right) => {
    const distance =
      haversineDistanceMeters(coordinate, left) - haversineDistanceMeters(coordinate, right);
    return distance !== 0 ? distance : left.id.localeCompare(right.id);
  });
}
