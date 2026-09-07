import type { Coordinate } from "@freshmarkets/contracts";
import { pointInPolygon, validCoordinate, type Position } from "../geometry";

const EPSILON = 1e-10;
function cross(a: Position, b: Position, c: Position) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: Position, b: Position, p: Position) {
  return (
    Math.abs(cross(a, b, p)) <= EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}
function intersects(a: Position, b: Position, c: Position, d: Position) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

/** Operator vertices form one simple exterior ring; stored read geometry still supports holes. */
export function servicePolygon(vertices: readonly Coordinate[]): readonly Position[] | null {
  if (
    vertices.length < 3 ||
    vertices.length > 100 ||
    vertices.some((point) => !validCoordinate(point.latitude, point.longitude))
  )
    return null;
  const ring: Position[] = vertices.map((point) => [point.longitude, point.latitude]);
  if (new Set(ring.map((point) => `${point[0]},${point[1]}`)).size !== ring.length) return null;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    if (Math.abs(a[0] - b[0]) > 180) return null;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return null;
    }
  }
  if (Math.abs(area) <= EPSILON) return null;
  return [...ring, ring[0]];
}

/** Check every interval of a zone edge, including crossings through concave area boundaries. */
export function polygonWithin(zone: readonly Position[], area: readonly Position[]): boolean {
  if (zone.some((point) => !pointInPolygon(point, [area]))) return false;
  for (let i = 0; i < zone.length - 1; i++) {
    const a = zone[i],
      b = zone[i + 1];
    const parameters = [0, 1];
    for (let j = 0; j < area.length - 1; j++) {
      const c = area[j],
        d = area[j + 1];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        ex = d[0] - c[0],
        ey = d[1] - c[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) <= EPSILON) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) parameters.push(t);
    }
    parameters.sort((left, right) => left - right);
    for (let j = 0; j < parameters.length - 1; j++) {
      const t = (parameters[j] + parameters[j + 1]) / 2;
      if (!pointInPolygon([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], [area]))
        return false;
    }
  }
  return true;
}
