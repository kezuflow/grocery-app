import type { Coordinate } from "@freshmarkets/contracts";
import { parsePolygonGeoJson, pointInPolygon, sortLocationsByDistance } from "../geometry";

export type OperationalCandidate = {
  id: string;
  locationId: string;
  locationName: string;
  marketId: string;
  marketCode: string;
  latitude: number;
  longitude: number;
  zoneId: string;
  zoneName: string;
  mode: "INSTANT" | "SCHEDULED";
  modeVersion: number;
  geographyVersion: number;
  locationVersion: number;
  readinessVersion: number | null;
  promiseMinutes: number | null;
};

/** Common geofence and operational eligibility for preview, options and quote routing. No stock reads. */
export async function operationalCandidates(
  database: D1Database,
  point: Coordinate,
  input: {
    marketId?: string;
    mode?: "INSTANT" | "SCHEDULED";
    cycleId?: string;
    now?: number;
  } = {},
): Promise<OperationalCandidate[]> {
  const now = input.now ?? Date.now();
  const rows = await database
    .prepare(`SELECT l.id,l.id locationId,l.name locationName,l.market_id marketId,m.code marketCode,
    l.latitude,l.longitude,z.id zoneId,z.name zoneName,g.fulfillment_mode mode,g.version modeVersion,
    revision.version geographyVersion,l.version locationVersion,r.version readinessVersion,r.instant_promise_minutes promiseMinutes,
    a.polygon_geojson areaPolygon,z.polygon_geojson zonePolygon
    FROM fulfillment_location l JOIN market m ON m.id=l.market_id AND m.status='active'
    JOIN geography_configuration revision ON revision.market_id=m.id
    JOIN location_serviceability link ON link.location_id=l.id AND link.eligible=1
      AND link.valid_from<=? AND (link.valid_to IS NULL OR link.valid_to>?)
    JOIN delivery_zone z ON z.id=link.zone_id AND z.status='active'
    JOIN service_area a ON a.id=z.service_area_id AND a.market_id=m.id AND a.status='active'
      AND a.active_from<=? AND (a.active_to IS NULL OR a.active_to>?)
    JOIN global_commerce_configuration g ON g.id='global'
    LEFT JOIN fulfillment_location_readiness r ON r.location_id=l.id
    WHERE l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
      AND (? IS NULL OR m.id=?) AND (? IS NULL OR g.fulfillment_mode=?)
      AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1
        AND capability IN ('PICKING','PACKING','DISPATCH'))=3
      AND ((g.fulfillment_mode='INSTANT' AND r.dispatch_ready=1 AND r.instant_promise_minutes IS NOT NULL
          AND r.max_concurrent_instant_orders IS NOT NULL)
        OR (g.fulfillment_mode='SCHEDULED' AND g.cadence='WEEKLY' AND EXISTS (
          SELECT 1 FROM delivery_cycle cycle JOIN delivery_cycle_zone participation ON participation.cycle_id=cycle.id
          WHERE cycle.market_id=m.id AND cycle.status='OPEN' AND cycle.cutoff_at>? AND cycle.order_opens_at<=?
            AND EXISTS (SELECT 1 FROM delivery_cycle_window w JOIN delivery_cycle_schedule s ON s.cycle_id=w.cycle_id
              WHERE w.cycle_id=cycle.id AND s.pickup_at<=w.starts_at AND w.starts_at<w.ends_at)
            AND participation.zone_id=z.id AND participation.location_id=l.id AND participation.status='ACTIVE'
            AND (? IS NULL OR cycle.id=?))))
    ORDER BY l.id,z.id`)
    .bind(
      now,
      now,
      now,
      now,
      input.marketId ?? null,
      input.marketId ?? null,
      input.mode ?? null,
      input.mode ?? null,
      now,
      now,
      input.cycleId ?? null,
      input.cycleId ?? null,
    )
    .all<OperationalCandidate & { areaPolygon: string; zonePolygon: string }>();
  const candidates = rows.results
    .filter((row) => {
      const area = parsePolygonGeoJson(row.areaPolygon),
        zone = parsePolygonGeoJson(row.zonePolygon);
      return (
        area !== null &&
        zone !== null &&
        pointInPolygon([point.longitude, point.latitude], area) &&
        pointInPolygon([point.longitude, point.latitude], zone)
      );
    })
    .map(({ areaPolygon: _area, zonePolygon: _zone, ...candidate }) => candidate);
  return sortLocationsByDistance(point, candidates);
}

export function geographyQuoteGuard(
  database: D1Database,
  candidate: OperationalCandidate,
  cycle?: { id: string; version: number },
): D1PreparedStatement {
  return database
    .prepare(`INSERT INTO commitment_abort(id) SELECT -26 WHERE NOT EXISTS (
      SELECT 1 FROM geography_configuration geography JOIN market m ON m.id=geography.market_id AND m.status='active'
      JOIN fulfillment_location l ON l.market_id=m.id AND l.id=? AND l.version=? AND l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
      JOIN location_serviceability link ON link.location_id=l.id AND link.zone_id=? AND link.eligible=1
      JOIN delivery_zone z ON z.id=link.zone_id AND z.status='active'
      JOIN service_area a ON a.id=z.service_area_id AND a.market_id=m.id AND a.status='active'
      JOIN global_commerce_configuration g ON g.id='global' AND g.version=? AND g.selling_state='OPEN'
      WHERE geography.market_id=? AND geography.version=?
        AND link.valid_from<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (link.valid_to IS NULL OR link.valid_to>CAST(unixepoch('subsec')*1000 AS INTEGER))
        AND a.active_from<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND (a.active_to IS NULL OR a.active_to>CAST(unixepoch('subsec')*1000 AS INTEGER))
        AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))=3
        AND ((g.fulfillment_mode='INSTANT' AND EXISTS (SELECT 1 FROM fulfillment_location_readiness WHERE location_id=l.id AND version=? AND dispatch_ready=1 AND instant_promise_minutes IS NOT NULL AND max_concurrent_instant_orders IS NOT NULL))
          OR (g.fulfillment_mode='SCHEDULED' AND g.cadence='WEEKLY' AND EXISTS (SELECT 1 FROM delivery_cycle cycle JOIN delivery_cycle_zone participation ON participation.cycle_id=cycle.id
            WHERE cycle.id=? AND cycle.version=? AND cycle.status='OPEN' AND cycle.cutoff_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
              AND cycle.order_opens_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
              AND participation.zone_id=z.id AND participation.location_id=l.id AND participation.status='ACTIVE')))
    )`)
    .bind(
      candidate.locationId,
      candidate.locationVersion,
      candidate.zoneId,
      candidate.modeVersion,
      candidate.marketId,
      candidate.geographyVersion,
      candidate.readinessVersion,
      cycle?.id ?? null,
      cycle?.version ?? null,
    );
}
