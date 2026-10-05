import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { seedTestInstantOrder } from "../../test-commerce-fixtures";
import { getDeliveryTracking } from "./get-delivery-tracking";

async function seed() {
  const id = `tracking-${crypto.randomUUID()}`;
  await seedTestInstantOrder(env.DB, id);
  await env.DB.prepare(
    "UPDATE grocery_order SET status='OUT_FOR_DELIVERY',address_snapshot_json=? WHERE id=?",
  )
    .bind(JSON.stringify({ latitude: 10.3173, longitude: 123.9058 }), id)
    .run();
  await env.DB.prepare(
    `INSERT INTO delivery_job (id,order_id,fulfillment_mode,location_id,zone_id,status,
      context_resolution_status,address_snapshot_json,version,created_at,updated_at)
     VALUES (?,?,'INSTANT','location-cebu-central','zone-cebu-city-core','EN_ROUTE',
      'RESOLVED','{}',1,1,1)`,
  )
    .bind(`job-${id}`, id)
    .run();
  await env.DB.prepare(
    `INSERT INTO delivery_provider_dispatch (id,delivery_job_id,provider,merchant_order_id,
      provider_delivery_id,request_hash,request_snapshot_json,status,provider_status,
      attempt_count,version,created_at,updated_at)
     VALUES (?,?,'lalamove',?,?,'hash','{}','ACTIVE','IN_DELIVERY',1,1,1,1)`,
  )
    .bind(`dispatch-${id}`, `job-${id}`, `merchant-${id}`, `provider-${id}`)
    .run();
  return id;
}

describe("delivery tracking projection", () => {
  it("serves current signed rider contact without GPS only within delivery access and clears it on rematch", async () => {
    const orderId = await seed();
    await env.DB.prepare(
      "UPDATE delivery_provider_dispatch SET driver_id='signed-rider',driver_observed_at=100 WHERE id=?",
    )
      .bind(`dispatch-${orderId}`)
      .run();
    await env.DB.prepare(
      "INSERT INTO delivery_provider_evidence(dispatch_id,kind,observed_at,evidence_json) VALUES (?,'DRIVER',100,?)",
    )
      .bind(
        `dispatch-${orderId}`,
        JSON.stringify({
          driverId: "signed-rider",
          name: "Sandbox rider",
          phone: "+639000000000",
          plateNumber: "TEST",
        }),
      )
      .run();
    const snapshot = vi.fn(async () => ({
      driverId: "signed-rider" as string | null,
      position: null,
      contact: null,
      unavailable: true,
    }));
    const runtime = {
      ...env,
      DELIVERY_TRACKING_HUB: { getByName: () => ({ snapshot }) },
    } as unknown as Env;
    const input = { orderId, customerId: `customer-${orderId}`, requestId: crypto.randomUUID() };
    expect(await getDeliveryTracking(runtime, { ...input, customerId: "other" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(snapshot).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE grocery_order SET status='FULFILLMENT_READY' WHERE id=?")
      .bind(orderId)
      .run();
    expect(await getDeliveryTracking(runtime, input)).toMatchObject({
      ok: true,
      value: { availability: "WAITING", riderContact: null },
    });
    expect(snapshot).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE grocery_order SET status='OUT_FOR_DELIVERY' WHERE id=?")
      .bind(orderId)
      .run();
    expect(await getDeliveryTracking(runtime, input)).toMatchObject({
      ok: true,
      value: {
        availability: "UNAVAILABLE",
        rider: null,
        riderContact: { name: "Sandbox rider", phone: "+639000000000", plateNumber: "TEST" },
      },
    });
    await env.DB.prepare(
      "UPDATE delivery_provider_dispatch SET driver_id=NULL,driver_observed_at=200 WHERE id=?",
    )
      .bind(`dispatch-${orderId}`)
      .run();
    snapshot.mockResolvedValue({
      driverId: null,
      position: null,
      contact: null,
      unavailable: true,
    });
    expect(await getDeliveryTracking(runtime, input)).toMatchObject({
      ok: true,
      value: { riderContact: null },
    });
    await env.DB.prepare("UPDATE delivery_provider_dispatch SET status='COMPLETED' WHERE id=?")
      .bind(`dispatch-${orderId}`)
      .run();
    expect(await getDeliveryTracking(runtime, input)).toMatchObject({
      ok: true,
      value: { availability: "FINISHED", riderContact: null },
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("enforces Order ownership and location before reading a provider position", async () => {
    const orderId = await seed();
    const snapshot = vi.fn(async () => ({
      driverId: "driver-1",
      position: {
        coordinate: { latitude: 10.31, longitude: 123.9 },
        updatedAt: new Date().toISOString(),
      },
      contact: { name: "Rider One", phone: "+639171234567" },
      unavailable: false,
    }));
    const suggestedRoute = vi.fn(async () => [
      { latitude: 10.31, longitude: 123.9 },
      { latitude: 10.315, longitude: 123.902 },
      { latitude: 10.3173, longitude: 123.9058 },
    ]);
    const runtime = {
      ...env,
      DELIVERY_TRACKING_HUB: { getByName: () => ({ snapshot, suggestedRoute }) },
    } as unknown as Env;
    const requestId = crypto.randomUUID();
    expect(
      await getDeliveryTracking(runtime, { orderId, customerId: "other", requestId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await getDeliveryTracking(runtime, { orderId, locationId: "other", requestId }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(snapshot).not.toHaveBeenCalled();
    expect(suggestedRoute).not.toHaveBeenCalled();
    const result = await getDeliveryTracking(runtime, {
      orderId,
      customerId: `customer-${orderId}`,
      requestId,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        availability: "LIVE",
        attemptId: `dispatch-${orderId}`,
        destination: { latitude: 10.3173, longitude: 123.9058 },
        rider: { coordinate: { latitude: 10.31, longitude: 123.9 } },
        riderContact: { name: "Rider One", phone: "+639171234567" },
        roadRoute: [
          { latitude: 10.31, longitude: 123.9 },
          { latitude: 10.315, longitude: 123.902 },
          { latitude: 10.3173, longitude: 123.9058 },
        ],
      },
    });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(suggestedRoute).toHaveBeenCalledWith(
      { latitude: 10.31, longitude: 123.9 },
      { latitude: 10.3173, longitude: 123.9058 },
    );
    expect(
      await env.DB.prepare("SELECT driver_id FROM delivery_provider_dispatch WHERE id=?")
        .bind(`dispatch-${orderId}`)
        .first(),
    ).toEqual({ driver_id: "driver-1" });
  });

  it("retains the last provider report and stops on a terminal dispatch", async () => {
    const orderId = await seed();
    const snapshot = vi.fn(async () => ({
      driverId: "driver-1",
      position: {
        coordinate: { latitude: 10.31, longitude: 123.9 },
        updatedAt: new Date(Date.now() - 121_000).toISOString(),
      },
      unavailable: true,
    }));
    const suggestedRoute = vi.fn(async () => [
      { latitude: 10.31, longitude: 123.9 },
      { latitude: 10.3173, longitude: 123.9058 },
    ]);
    const runtime = {
      ...env,
      DELIVERY_TRACKING_HUB: { getByName: () => ({ snapshot, suggestedRoute }) },
    } as unknown as Env;
    const requestId = crypto.randomUUID();
    expect(
      await getDeliveryTracking(runtime, { orderId, customerId: `customer-${orderId}`, requestId }),
    ).toMatchObject({
      ok: true,
      value: {
        availability: "DELAYED",
        rider: { coordinate: { latitude: 10.31 } },
        roadRoute: [{ latitude: 10.31 }, { latitude: 10.3173 }],
      },
    });
    await env.DB.prepare("UPDATE delivery_provider_dispatch SET status='COMPLETED' WHERE id=?")
      .bind(`dispatch-${orderId}`)
      .run();
    expect(
      await getDeliveryTracking(runtime, { orderId, customerId: `customer-${orderId}`, requestId }),
    ).toMatchObject({
      ok: true,
      value: { availability: "FINISHED", rider: null, riderContact: null },
    });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(suggestedRoute).toHaveBeenCalledOnce();
  });

  it("identifies a replacement attempt even when its provider read is unavailable", async () => {
    const orderId = await seed();
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce({
        driverId: "driver-1",
        position: {
          coordinate: { latitude: 10.31, longitude: 123.9 },
          updatedAt: new Date().toISOString(),
        },
        unavailable: false,
      })
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const runtime = {
      ...env,
      DELIVERY_TRACKING_HUB: { getByName: () => ({ snapshot }) },
    } as unknown as Env;
    const request = {
      orderId,
      customerId: `customer-${orderId}`,
      requestId: crypto.randomUUID(),
    };
    expect(await getDeliveryTracking(runtime, request)).toMatchObject({
      ok: true,
      value: { availability: "LIVE", attemptId: `dispatch-${orderId}` },
    });

    await env.DB.prepare("UPDATE delivery_provider_dispatch SET status='FAILED' WHERE id=?")
      .bind(`dispatch-${orderId}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO delivery_provider_dispatch (id,attempt_sequence,delivery_job_id,provider,
        merchant_order_id,provider_delivery_id,request_hash,request_snapshot_json,status,
        provider_status,attempt_count,version,created_at,updated_at)
       VALUES (?,2,?,'lalamove',?,?,'hash-2','{}','ACTIVE','ALLOCATING',1,1,2,2)`,
    )
      .bind(
        `replacement-${orderId}`,
        `job-${orderId}`,
        `merchant-replacement-${orderId}`,
        `provider-replacement-${orderId}`,
      )
      .run();
    expect(await getDeliveryTracking(runtime, request)).toMatchObject({
      ok: true,
      value: {
        availability: "UNAVAILABLE",
        attemptId: `replacement-${orderId}`,
        rider: null,
      },
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("returns a valid rider position when the optional driver-reference write fails", async () => {
    const orderId = await seed();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const database = {
      prepare(statement: string) {
        if (statement.includes("UPDATE delivery_provider_dispatch SET driver_id="))
          return {
            bind: () => ({
              run: async () => {
                throw new Error("D1 write unavailable");
              },
            }),
          };
        return env.DB.prepare(statement);
      },
    } as unknown as Env["DB"];
    const runtime = {
      ...env,
      DB: database,
      DELIVERY_TRACKING_HUB: {
        getByName: () => ({
          snapshot: async () => ({
            driverId: "driver-1",
            position: {
              coordinate: { latitude: 10.31, longitude: 123.9 },
              updatedAt: new Date().toISOString(),
            },
            unavailable: false,
          }),
          suggestedRoute: async () => {
            throw new Error("Routes API unavailable");
          },
        }),
      },
    } as unknown as Env;
    const result = await getDeliveryTracking(runtime, {
      orderId,
      customerId: `customer-${orderId}`,
      requestId: crypto.randomUUID(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        availability: "LIVE",
        rider: { coordinate: { latitude: 10.31 } },
        roadRoute: null,
      },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("delivery.tracking.driver_reference_write_failed"),
    );
    warning.mockRestore();
  });

  it("reports a failed provider lookup without a rider assignment as unavailable", async () => {
    const orderId = await seed();
    const runtime = {
      ...env,
      DELIVERY_TRACKING_HUB: {
        getByName: () => ({
          snapshot: async () => ({ driverId: null, position: null, unavailable: true }),
        }),
      },
    } as unknown as Env;
    expect(
      await getDeliveryTracking(runtime, {
        orderId,
        customerId: `customer-${orderId}`,
        requestId: crypto.randomUUID(),
      }),
    ).toMatchObject({
      ok: true,
      value: { availability: "UNAVAILABLE", rider: null, riderContact: null },
    });
  });
});
