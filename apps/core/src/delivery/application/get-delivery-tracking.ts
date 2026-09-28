import type { Coordinate, DeliveryTrackingView, RpcResult } from "@freshmarkets/contracts";

type TrackingRow = {
  customer_id: string;
  order_status: string;
  job_status: string | null;
  location_id: string | null;
  address_snapshot_json: string;
  stop_latitude: number | null;
  stop_longitude: number | null;
  dispatch_id: string | null;
  method: string | null;
  provider: string | null;
  dispatch_status: string | null;
  provider_delivery_id: string | null;
  driver_id: string | null;
};

function coordinate(latitude: unknown, longitude: unknown): Coordinate | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  return { latitude, longitude };
}

function destination(row: TrackingRow): Coordinate | null {
  const stop = coordinate(row.stop_latitude, row.stop_longitude);
  if (stop) return stop;
  try {
    const address = JSON.parse(row.address_snapshot_json) as Record<string, unknown>;
    return coordinate(address.latitude, address.longitude);
  } catch {
    return null;
  }
}

function view(
  availability: DeliveryTrackingView["availability"],
  position: Coordinate | null,
  updatedAt: string | null,
  destinationCoordinate: Coordinate | null,
): DeliveryTrackingView {
  return {
    availability,
    destination: destinationCoordinate,
    rider: position && updatedAt ? { coordinate: position, updatedAt } : null,
    nextRefreshMilliseconds:
      availability === "LIVE" ||
      availability === "DELAYED" ||
      availability === "WAITING" ||
      availability === "UNAVAILABLE"
        ? 30_000
        : null,
  };
}

export async function getDeliveryTracking(
  env: Env,
  input: { orderId: string; requestId: string; customerId?: string; locationId?: string },
): Promise<RpcResult<DeliveryTrackingView>> {
  const row = await env.DB.prepare(
    `SELECT o.customer_id,o.status AS order_status,job.status AS job_status,
      job.location_id,o.address_snapshot_json,stop.latitude AS stop_latitude,
      stop.longitude AS stop_longitude,dispatch.id AS dispatch_id,dispatch.method,
      dispatch.provider,dispatch.status AS dispatch_status,
      dispatch.provider_delivery_id,dispatch.driver_id
     FROM grocery_order o
     LEFT JOIN delivery_job job ON job.order_id=o.id
     LEFT JOIN delivery_stop stop ON stop.id=(
       SELECT s.id FROM delivery_stop s WHERE s.delivery_job_id=job.id ORDER BY s.created_at,s.id LIMIT 1)
     LEFT JOIN delivery_provider_dispatch dispatch ON dispatch.id=(
       SELECT d.id FROM delivery_provider_dispatch d WHERE d.delivery_job_id=job.id
       ORDER BY d.attempt_sequence DESC LIMIT 1)
     WHERE o.id=?`,
  )
    .bind(input.orderId)
    .first<TrackingRow>();
  if (
    !row ||
    (input.customerId && row.customer_id !== input.customerId) ||
    (input.locationId && row.location_id !== input.locationId)
  )
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Order not found", requestId: input.requestId },
    };
  const pin = destination(row);
  if (row.method !== "EXTERNAL" || row.provider !== "lalamove")
    return { ok: true, value: view("NOT_SUPPORTED", null, null, null), requestId: input.requestId };
  if (
    ["DELIVERED", "CANCELED", "EXCEPTION"].includes(row.order_status) ||
    ["DELIVERED", "CANCELED"].includes(row.job_status ?? "") ||
    ["COMPLETED", "CANCELED", "FAILED", "RETURNED"].includes(row.dispatch_status ?? "")
  )
    return { ok: true, value: view("FINISHED", null, null, null), requestId: input.requestId };
  if (
    input.customerId &&
    (row.order_status !== "OUT_FOR_DELIVERY" ||
      !["EN_ROUTE", "ARRIVED"].includes(row.job_status ?? ""))
  )
    return { ok: true, value: view("WAITING", null, null, null), requestId: input.requestId };
  if (!row.provider_delivery_id)
    return { ok: true, value: view("WAITING", null, null, pin), requestId: input.requestId };
  try {
    const observation = await env.DELIVERY_TRACKING_HUB.getByName(
      env.LALAMOVE_MARKET || "PH",
    ).snapshot(row.provider_delivery_id, row.driver_id);
    if (observation.driverId && observation.driverId !== row.driver_id && row.dispatch_id)
      await env.DB.prepare(
        `UPDATE delivery_provider_dispatch SET driver_id=? WHERE id=? AND provider_delivery_id=?
         AND status='ACTIVE' AND driver_id IS ? AND id=(SELECT id FROM delivery_provider_dispatch
           WHERE delivery_job_id=(SELECT delivery_job_id FROM delivery_provider_dispatch WHERE id=?)
           ORDER BY attempt_sequence DESC LIMIT 1)`,
      )
        .bind(
          observation.driverId,
          row.dispatch_id,
          row.provider_delivery_id,
          row.driver_id,
          row.dispatch_id,
        )
        .run();
    const lastUpdate = observation.position?.updatedAt ?? null;
    const age = lastUpdate ? Date.now() - Date.parse(lastUpdate) : Number.POSITIVE_INFINITY;
    const position =
      age >= 0 && age <= 120_000
        ? coordinate(
            observation.position?.coordinate.latitude,
            observation.position?.coordinate.longitude,
          )
        : null;
    const availability = position
      ? age <= 30_000 && !observation.unavailable
        ? "LIVE"
        : "DELAYED"
      : observation.unavailable
        ? "UNAVAILABLE"
        : "WAITING";
    return {
      ok: true,
      value: view(availability, position, position ? lastUpdate : null, pin),
      requestId: input.requestId,
    };
  } catch {
    return { ok: true, value: view("UNAVAILABLE", null, null, pin), requestId: input.requestId };
  }
}
