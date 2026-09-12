import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { buildRouteDistancePort } from "../../geography/infrastructure/runtime-route-distance";
import { listFulfillmentOptions } from "./list-fulfillment-options";
import { createMockDeliveryProvider } from "../../delivery/infrastructure/mock-delivery-provider";

const provider = createMockDeliveryProvider();

describe("listFulfillmentOptions", () => {
  it("binds options to confirmed address/cart versions and hides routing", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `options-customer-${suffix}`;
    const addressId = `options-address-${suffix}`;
    const cartId = `options-cart-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='SCHEDULED',cadence='WEEKLY',version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,serviceable,status,version,user_confirmed_at,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.32,123.9,'CEBU_CITY_CORE',1,'active',2,?,?,?)",
      ).bind(addressId, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',3,?,?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',1)",
      ).bind(cartId),
    ]);
    await env.DB.prepare(`INSERT INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at)
      SELECT 'second-options-window',id,'Evening',delivery_date+14400000,delivery_date+21600000,0 FROM delivery_cycle WHERE id='cycle-next-cebu'`).run();
    const query = {
      customerId,
      addressId,
      addressVersion: 2,
      cartId,
      cartVersion: 3,
      requestId: "options",
    };
    const result = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      query,
      {
        scheduledDeliveryPartner: {
          providerCode: "lalamove",
          displayName: "Lalamove",
          serviceType: "MOTORCYCLE",
          serviceLabel: "Motorcycle",
          provider,
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((option) => option.mode)).toEqual(["SCHEDULED", "SCHEDULED"]);
    expect(new Set(result.value.map((option) => option.optionId)).size).toBe(2);
    expect(result.value.map((option) => option.deliveryWindow?.name)).toEqual([
      "Test delivery window",
      "Evening",
    ]);
    expect(result.value.every((option) => option.eligible)).toBe(true);
    for (const option of result.value) {
      expect(option.deliveryWindow?.windowId).toBeTruthy();
      expect(
        Date.parse(option.deliveryWindow?.endsAt ?? "") -
          Date.parse(option.deliveryWindow?.startsAt ?? ""),
      ).toBe(2 * 3600000);
    }
    expect(JSON.stringify(result.value)).not.toMatch(/location-cebu|zone-cebu|hub/i);
    expect(result.value.every((option) => option.optionId.startsWith("fulfillment_"))).toBe(true);
    const stale = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      { ...query, addressVersion: 1 },
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION" } });
  });

  it("offers configured partners only for Instant and keeps provider authority inside the opaque id", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `instant-options-customer-${suffix}`;
    const addressId = `instant-options-address-${suffix}`;
    const cartId = `instant-options-cart-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "UPDATE fulfillment_location_readiness SET dispatch_ready=1,instant_promise_minutes=45,max_concurrent_instant_orders=10,version=version+1,updated_at=? WHERE location_id='location-cebu-central'",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,serviceable,status,version,user_confirmed_at,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.32,123.9,'CEBU_CITY_CORE',1,'active',2,?,?,?)",
      ).bind(addressId, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',3,?,?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',1)",
      ).bind(cartId),
    ]);

    const result = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      {
        customerId,
        addressId,
        addressVersion: 2,
        cartId,
        cartVersion: 3,
        requestId: "instant-options",
      },
      {
        instantDeliveryPartners: [
          {
            providerCode: "lalamove",
            displayName: "Lalamove",
            serviceType: "MOTORCYCLE",
            serviceLabel: "Motorcycle",
            provider,
          },
          {
            providerCode: "grab-express",
            displayName: "GrabExpress",
            serviceType: "INSTANT",
            serviceLabel: "Instant",
            provider,
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((option) => option.deliveryPartner?.displayName)).toEqual([
      "Lalamove",
      "GrabExpress",
    ]);
    expect(new Set(result.value.map((option) => option.optionId)).size).toBe(2);
    expect(JSON.stringify(result.value)).not.toMatch(/location-cebu|zone-cebu|quotationId/i);
  });

  it("blocks checkout outside every global service area before requesting a courier quote", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `outside-options-customer-${suffix}`;
    const addressId = `outside-options-address-${suffix}`;
    const cartId = `outside-options-cart-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,serviceable,status,version,user_confirmed_at,created_at,updated_at) VALUES (?,?,'Manila','Customer','+639171234567','{}',14.5995,120.9842,1,'active',2,?,?,?)",
      ).bind(addressId, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',3,?,?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',1)",
      ).bind(cartId),
    ]);
    const quote = vi.fn(provider.quote.bind(provider));
    const result = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      {
        customerId,
        addressId,
        addressVersion: 2,
        cartId,
        cartVersion: 3,
        requestId: "outside-service-areas",
      },
      {
        instantDeliveryPartners: [
          {
            providerCode: "lalamove",
            displayName: "Lalamove",
            serviceType: "MOTORCYCLE",
            serviceLabel: "Motorcycle",
            provider: { ...provider, quote },
          },
        ],
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: [{ eligible: false, unavailableReason: "MODE_UNAVAILABLE" }],
    });
    expect(quote).not.toHaveBeenCalled();
  });

  it("fails Instant partner options closed when a non-gram cart line has no shipping weight", async () => {
    const suffix = crypto.randomUUID();
    const customerId = `weight-options-customer-${suffix}`;
    const addressId = `weight-options-address-${suffix}`;
    const cartId = `weight-options-cart-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE global_commerce_configuration SET selling_state='OPEN',fulfillment_mode='INSTANT',cadence=NULL,version=version+1,updated_at=? WHERE id='global'",
      ).bind(now),
      env.DB.prepare(
        "UPDATE fulfillment_location_readiness SET dispatch_ready=1,instant_promise_minutes=45,max_concurrent_instant_orders=10,version=version+1,updated_at=? WHERE location_id='location-cebu-central'",
      ).bind(now),
      env.DB.prepare(
        "UPDATE inventory_pool SET base_unit_id='unit-piece' WHERE id='pool-red-onion'",
      ),
      env.DB.prepare(
        "INSERT INTO customer (id,auth_user_id,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
      ).bind(customerId, `auth-${customerId}`, now, now),
      env.DB.prepare(
        "INSERT INTO customer_address (id,customer_id,label,recipient,phone,address_json,latitude,longitude,delivery_zone_code,serviceable,status,version,user_confirmed_at,created_at,updated_at) VALUES (?,?,'Home','Customer','+639171234567','{}',10.32,123.9,'CEBU_CITY_CORE',1,'active',2,?,?,?)",
      ).bind(addressId, customerId, now, now, now),
      env.DB.prepare(
        "INSERT INTO cart (id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,'location-cebu-central','ACTIVE',3,?,?)",
      ).bind(cartId, customerId, now, now),
      env.DB.prepare(
        "INSERT INTO cart_item (cart_id,sku_id,quantity) VALUES (?,'sku-red-onion-500g',1)",
      ).bind(cartId),
    ]);

    const result = await listFulfillmentOptions(
      env.DB,
      buildRouteDistancePort({ ENVIRONMENT: "test", ROUTE_DISTANCE_PROVIDER: "mock" }),
      {
        customerId,
        addressId,
        addressVersion: 2,
        cartId,
        cartVersion: 3,
        requestId: "missing-weight-options",
      },
      {
        instantDeliveryPartners: [
          {
            providerCode: "lalamove",
            displayName: "Lalamove",
            serviceType: "MOTORCYCLE",
            serviceLabel: "Motorcycle",
            provider,
          },
        ],
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          eligible: false,
          unavailableReason: "DELIVERY_WEIGHT_UNAVAILABLE",
          deliveryPartner: { code: "lalamove" },
        },
      ],
    });
  });
});
