import { DurableObject } from "cloudflare:workers";
import type { Coordinate } from "@freshmarkets/contracts";
import { buildRoutePreviewPort } from "../../geography/infrastructure/runtime-route-preview";
import { buildDeliveryProviderRegistry } from "./runtime-delivery-provider";

type Position = { coordinate: { latitude: number; longitude: number }; updatedAt: string };
type Contact = { name: string | null; phone: string | null };
type TrackingResult = {
  driverId: string | null;
  position: Position | null;
  contact: Contact | null;
  unavailable: boolean;
};
const ROUTE_CACHE_MILLISECONDS = 5 * 60_000;

/** A missing driver clears the old pin; other failures can retain a last report. */
export function observationAfterLocationError(
  errorCode: string,
  driverId: string,
  cachedPosition: Position | null,
): TrackingResult {
  return errorCode === "LALAMOVE_HTTP_404"
    ? { driverId: null, position: null, contact: null, unavailable: false }
    : { driverId, position: cachedPosition, contact: null, unavailable: true };
}

/** One per market. Provider coordinates remain only in this object's memory. */
export class DeliveryTrackingHub extends DurableObject<Env> {
  private readonly positions = new Map<
    string,
    { position: Position; contact: Contact; fetchedAt: number }
  >();
  private readonly pending = new Map<string, Promise<TrackingResult>>();
  private readonly routes = new Map<string, { points: Coordinate[]; fetchedAt: number }>();
  private readonly pendingRoutes = new Map<string, Promise<Coordinate[] | null>>();

  private async admit(
    key = "tracking-budget",
    limit = this.env.ENVIRONMENT === "production" ? 240 : 40,
  ): Promise<boolean> {
    const now = Date.now();
    return this.ctx.storage.transaction(async (storage) => {
      const previous = await storage.get<{ startsAt: number; count: number }>(key);
      const current =
        previous && now - previous.startsAt < 60_000 ? previous : { startsAt: now, count: 0 };
      if (current.count >= limit) return false;
      await storage.put(key, { startsAt: current.startsAt, count: current.count + 1 });
      return true;
    });
  }

  /** Route coordinates are temporary Google display content, never persisted as tracking history. */
  async suggestedRoute(origin: Coordinate, destination: Coordinate): Promise<Coordinate[] | null> {
    if (!this.env.GOOGLE_MAPS_SERVER_KEY) return null;
    const key = `${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;
    const now = Date.now();
    const cached = this.routes.get(key);
    if (cached && now - cached.fetchedAt < ROUTE_CACHE_MILLISECONDS) return cached.points;
    const inFlight = this.pendingRoutes.get(key);
    if (inFlight) return inFlight;
    const work = (async () => {
      if (!(await this.admit("route-budget", this.env.ENVIRONMENT === "production" ? 120 : 20)))
        return null;
      try {
        const route = await buildRoutePreviewPort(this.env).preview({
          origin,
          orderedDestinations: [destination],
        });
        const points = route.geometry.coordinates.map(([longitude, latitude]) => ({
          latitude,
          longitude,
        }));
        this.routes.set(key, { points, fetchedAt: Date.now() });
        for (const [routeKey, value] of this.routes)
          if (Date.now() - value.fetchedAt >= ROUTE_CACHE_MILLISECONDS)
            this.routes.delete(routeKey);
        if (this.routes.size > 256) {
          const oldest = this.routes.keys().next().value;
          if (oldest) this.routes.delete(oldest);
        }
        return points;
      } catch {
        return null;
      }
    })();
    this.pendingRoutes.set(key, work);
    try {
      return await work;
    } finally {
      this.pendingRoutes.delete(key);
    }
  }

  async snapshot(providerOrderId: string, savedDriverId: string | null): Promise<TrackingResult> {
    if (
      !providerOrderId ||
      providerOrderId.length > 64 ||
      (savedDriverId && savedDriverId.length > 64)
    )
      return { driverId: null, position: null, contact: null, unavailable: true };
    const key = `${providerOrderId}:${savedDriverId ?? "unassigned"}`;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const work = this.read(providerOrderId, savedDriverId);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private async read(
    providerOrderId: string,
    savedDriverId: string | null,
    allowReassignment = true,
  ): Promise<TrackingResult> {
    const provider = buildDeliveryProviderRegistry(this.env).get("lalamove");
    if (!provider?.getDriverLocation)
      return { driverId: savedDriverId, position: null, contact: null, unavailable: true };
    let driverId = savedDriverId;
    if (!driverId) {
      if (!(await this.admit()))
        return { driverId: null, position: null, contact: null, unavailable: true };
      const order = await provider.get(providerOrderId);
      if (!order.ok || !order.value || order.value.providerDeliveryId !== providerOrderId)
        return { driverId: null, position: null, contact: null, unavailable: true };
      driverId = order.value.driverId ?? null;
      if (!driverId) return { driverId: null, position: null, contact: null, unavailable: false };
    }
    const key = `${providerOrderId}:${driverId}`;
    const cached = this.positions.get(key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 30_000)
      return { driverId, position: cached.position, contact: cached.contact, unavailable: false };
    if (!(await this.admit()))
      return { driverId, position: cached?.position ?? null, contact: null, unavailable: true };
    const observed = await provider.getDriverLocation(providerOrderId, driverId);
    if (observed.ok) {
      const position = {
        coordinate: observed.value.coordinate,
        updatedAt: observed.value.updatedAt,
      };
      this.positions.set(key, { position, contact: observed.value.contact, fetchedAt: now });
      for (const [otherKey, value] of this.positions)
        if (now - value.fetchedAt > 120_000) this.positions.delete(otherKey);
      return { driverId, position, contact: observed.value.contact, unavailable: false };
    }
    if (observed.error.code === "LALAMOVE_HTTP_404") this.positions.delete(key);
    // A driver can be reassigned without a new status observation reaching Core.
    if (
      observed.error.code === "LALAMOVE_HTTP_404" &&
      allowReassignment &&
      savedDriverId &&
      (await this.admit())
    ) {
      const order = await provider.get(providerOrderId);
      if (order.ok && order.value?.driverId && order.value.driverId !== savedDriverId) {
        const replacement = await this.read(providerOrderId, order.value.driverId, false);
        return replacement.position ? replacement : { ...replacement, unavailable: false };
      }
    }
    return observationAfterLocationError(observed.error.code, driverId, cached?.position ?? null);
  }
}
