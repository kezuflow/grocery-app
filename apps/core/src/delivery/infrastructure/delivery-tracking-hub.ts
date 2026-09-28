import { DurableObject } from "cloudflare:workers";
import { buildDeliveryProviderRegistry } from "./runtime-delivery-provider";

type Position = { coordinate: { latitude: number; longitude: number }; updatedAt: string };
type TrackingResult = {
  driverId: string | null;
  position: Position | null;
  unavailable: boolean;
};

/** One per market. Provider coordinates remain only in this object's memory. */
export class DeliveryTrackingHub extends DurableObject<Env> {
  private readonly positions = new Map<string, { position: Position; fetchedAt: number }>();
  private readonly pending = new Map<string, Promise<TrackingResult>>();

  private async admit(): Promise<boolean> {
    const now = Date.now();
    const limit = this.env.ENVIRONMENT === "production" ? 240 : 40;
    return this.ctx.storage.transaction(async (storage) => {
      const key = "tracking-budget";
      const previous = await storage.get<{ startsAt: number; count: number }>(key);
      const current =
        previous && now - previous.startsAt < 60_000 ? previous : { startsAt: now, count: 0 };
      if (current.count >= limit) return false;
      await storage.put(key, { startsAt: current.startsAt, count: current.count + 1 });
      return true;
    });
  }

  async snapshot(providerOrderId: string, savedDriverId: string | null): Promise<TrackingResult> {
    if (
      !providerOrderId ||
      providerOrderId.length > 64 ||
      (savedDriverId && savedDriverId.length > 64)
    )
      return { driverId: null, position: null, unavailable: true };
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
      return { driverId: savedDriverId, position: null, unavailable: true };
    let driverId = savedDriverId;
    if (!driverId) {
      if (!(await this.admit())) return { driverId: null, position: null, unavailable: true };
      const order = await provider.get(providerOrderId);
      if (!order.ok || !order.value || order.value.providerDeliveryId !== providerOrderId)
        return { driverId: null, position: null, unavailable: true };
      driverId = order.value.driverId ?? null;
      if (!driverId) return { driverId: null, position: null, unavailable: false };
    }
    const key = `${providerOrderId}:${driverId}`;
    const cached = this.positions.get(key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 30_000)
      return { driverId, position: cached.position, unavailable: false };
    if (!(await this.admit()))
      return { driverId, position: cached?.position ?? null, unavailable: true };
    const observed = await provider.getDriverLocation(providerOrderId, driverId);
    if (observed.ok) {
      this.positions.set(key, { position: observed.value, fetchedAt: now });
      for (const [otherKey, value] of this.positions)
        if (now - value.fetchedAt > 120_000) this.positions.delete(otherKey);
      return { driverId, position: observed.value, unavailable: false };
    }
    // A driver can be reassigned without a new status observation reaching Core.
    if (
      observed.error.code === "LALAMOVE_HTTP_404" &&
      allowReassignment &&
      savedDriverId &&
      (await this.admit())
    ) {
      const order = await provider.get(providerOrderId);
      if (order.ok && order.value?.driverId && order.value.driverId !== savedDriverId)
        return this.read(providerOrderId, order.value.driverId, false);
    }
    return { driverId, position: cached?.position ?? null, unavailable: true };
  }
}
